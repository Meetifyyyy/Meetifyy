import { useState } from 'react';
import { useAuth } from '@shared/context/AuthContext';
import { showToast } from '@shared/utils/toast';
import { Upload, Loader2, CheckCircle2, AlertCircle } from '@shared/components/icons';
import styles from '../pages/SettingsRoute.module.css';
import { useQueryClient } from '@tanstack/react-query';
import VerificationCameraCapture from './VerificationCameraCapture';

export default function SettingsVerificationPanel() {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [selfieFile, setSelfieFile] = useState(null);
  const [collegeIdFile, setCollegeIdFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const status = currentUser?.verificationStatus || 'UNVERIFIED';

  const handleFileChange = (e, setFile) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selfieFile || !collegeIdFile) {
      showToast('Please provide both required images', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const { uploadsApi, apiClient } = await import('@shared/api/apiClient');
      
      const selfieRes = await uploadsApi.uploadMedia(selfieFile, 'verification');
      const collegeIdRes = await uploadsApi.uploadMedia(collegeIdFile, 'verification');

      await apiClient.post('/api/verification/request', {
        selfieMediaId: selfieRes.id,
        idCardMediaId: collegeIdRes.id,
      });

      showToast('Verification request submitted successfully', 'success');
      // Trigger a sync to update the current user's status
      queryClient.invalidateQueries({ queryKey: ['feed'] });
      // To properly refresh userStore/currentUser:
      apiClient.post('/api/auth/sync').then(res => {
        // the AuthContext interceptor handles the cache update automatically
      });
      setSelfieFile(null);
      setCollegeIdFile(null);
      
      // Reload page to reflect changes from auth context immediately
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      showToast(err?.message || 'Failed to submit verification request', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`${styles.body} animate-in`}>
      <div className={styles.group} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--color-text-main, var(--color-text))', margin: 0 }}>
              Current Status
            </h3>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '2px 8px',
              borderRadius: '9999px',
              fontSize: '0.75rem',
              fontWeight: 500,
              textTransform: 'capitalize',
              backgroundColor: 
                status === 'VERIFIED' ? 'rgba(34, 197, 94, 0.12)' : 
                status === 'PENDING' ? 'rgba(234, 179, 8, 0.12)' : 
                status === 'REJECTED' ? 'rgba(239, 68, 68, 0.12)' : 
                'rgba(148, 163, 184, 0.12)',
              color: 
                status === 'VERIFIED' ? '#22c55e' : 
                status === 'PENDING' ? '#eab308' : 
                status === 'REJECTED' ? '#ef4444' : 
                'var(--color-text-muted, #94a3b8)'
            }}>
              {status.toLowerCase()}
            </span>
          </div>
          <p style={{ fontSize: '0.815rem', color: 'var(--color-text-muted, var(--color-text-light))', margin: '0.35rem 0 0', lineHeight: 1.45 }}>
            Verification unlocks campus features, messaging, and community access.
          </p>
        </div>

        {status === 'VERIFIED' && (
          <div style={{ background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)', padding: '1rem', borderRadius: '12px', display: 'flex', gap: '0.75rem', alignItems: 'flex-start', marginTop: '1rem' }}>
            <CheckCircle2 size={20} color="#22c55e" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div>
              <p style={{ color: 'var(--color-text)', fontWeight: 500 }}>You are fully verified.</p>
              <p style={{ color: 'var(--color-text-light)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Thank you for helping keep the Meetifyy community safe and authentic.</p>
            </div>
          </div>
        )}

        {status === 'PENDING' && (
          <div style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.2)', padding: '1rem', borderRadius: '12px', display: 'flex', gap: '0.75rem', alignItems: 'flex-start', marginTop: '1rem' }}>
            <Loader2 size={20} color="#eab308" style={{ flexShrink: 0, marginTop: '2px' }} className="spinner" />
            <div>
              <p style={{ color: 'var(--color-text)', fontWeight: 500 }}>Review in progress</p>
              <p style={{ color: 'var(--color-text-light)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Our team is reviewing your verification request. This usually takes less than 24 hours.</p>
            </div>
          </div>
        )}

        {(status === 'UNVERIFIED' || status === 'REJECTED' || status === 'RESUBMISSION_REQUIRED') && (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1rem' }}>
            {status === 'REJECTED' && (
              <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '1rem', borderRadius: '12px', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <AlertCircle size={20} color="#ef4444" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <p style={{ color: 'var(--color-text)', fontWeight: 500 }}>Previous request rejected</p>
                  <p style={{ color: 'var(--color-text-light)', fontSize: '0.875rem', marginTop: '0.25rem' }}>Please make sure your photos are clear and your college ID matches your profile name.</p>
                </div>
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>1. Take a clear selfie</label>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', marginBottom: '0.75rem' }}>This helps us verify you are a real person.</p>
              <VerificationCameraCapture
                value={selfieFile}
                onChange={setSelfieFile}
                isSubmitting={isSubmitting}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>2. Upload your College ID</label>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-light)', marginBottom: '0.75rem' }}>We use this to confirm your student status. We do not store this permanently.</p>
              <input type="file" accept="image/*" onChange={(e) => handleFileChange(e, setCollegeIdFile)} style={{ display: 'none' }} id="id-upload" />
              <label htmlFor="id-upload" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                padding: '1rem', background: 'var(--color-bg-panel)', border: '1px dashed var(--color-border)', borderRadius: '8px',
                cursor: 'pointer', transition: 'border-color 0.2s'
              }}>
                <Upload size={18} color="var(--color-text-light)" />
                <span style={{ color: collegeIdFile ? 'var(--color-text)' : 'var(--color-text-light)', fontSize: '0.875rem' }}>
                  {collegeIdFile ? collegeIdFile.name : 'Choose your College ID photo'}
                </span>
              </label>
            </div>

            <button type="submit" disabled={isSubmitting || !selfieFile || !collegeIdFile} style={{
              marginTop: '0.5rem',
              padding: '0.875rem',
              borderRadius: '9999px',
              background: 'var(--color-brand, var(--color-primary, #2563eb))',
              color: 'white',
              fontWeight: 600,
              fontSize: '1rem',
              border: 'none',
              cursor: (isSubmitting || !selfieFile || !collegeIdFile) ? 'not-allowed' : 'pointer',
              opacity: (isSubmitting || !selfieFile || !collegeIdFile) ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem'
            }}>
              {isSubmitting ? <Loader2 size={18} className="spinner" /> : 'Submit for Verification'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
