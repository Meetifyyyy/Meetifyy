import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { REPORT_REASONS } from '@shared/api/reports/report-constants';
import { useReportMutation } from '@shared/api/reports/useReportMutation';
import styles from './ReportModal.module.css';

const reportFormSchema = z
  .object({
    reason: z.string({ required_error: 'Please select a reason' }),
    description: z.string().max(500, 'Description cannot exceed 500 characters').optional(),
  })
  .refine(
    (data) => {
      if (data.reason === 'OTHER') {
        return !!data.description && data.description.trim().length > 0;
      }
      return true;
    },
    {
      message: 'Please provide a description when selecting "Other"',
      path: ['description'],
    }
  );

/**
 * Universal ReportModal Component
 *
 * Props:
 *   isOpen: boolean
 *   onClose: () => void
 *   targetType: 'USER' | 'POST' | 'COMMENT' | 'ACTIVITY' | 'COMMUNITY' | 'MESSAGE' | 'GROUP'
 *   targetId: string
 *   targetName?: string
 *   targetPreview?: string
 *   targetAvatar?: string
 *   reportedFrom?: string
 *   onSubmitted?: () => void
 */
export default function ReportModal({
  isOpen,
  onClose,
  targetType,
  targetId,
  targetName,
  targetPreview,
  targetAvatar,
  reportedFrom = 'app',
  onSubmitted,
}) {
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(reportFormSchema),
    defaultValues: {
      reason: '',
      description: '',
    },
  });

  const selectedReason = watch('reason');

  const { mutate: submitReport, isPending } = useReportMutation({
    onSuccess: () => {
      reset();
      if (onSubmitted) onSubmitted();
      onClose();
    },
  });

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !targetId || !targetType) return null;

  const onSubmit = (data) => {
    submitReport({
      targetType,
      targetId,
      reason: data.reason,
      description: data.description?.trim() || undefined,
      metadata: {
        reportedFrom,
        targetName,
        targetPreview: targetPreview?.slice(0, 100),
      },
    });
  };

  const getTargetTitle = () => {
    switch (targetType) {
      case 'USER':
        return targetName ? `Report @${targetName}` : 'Report User';
      case 'POST':
        return 'Report Post';
      case 'COMMENT':
        return 'Report Comment';
      case 'COMMUNITY':
        return targetName ? `Report ${targetName}` : 'Report Community';
      case 'ACTIVITY':
        return targetName ? `Report ${targetName}` : 'Report Activity';
      case 'GROUP':
      case 'MESSAGE':
        return 'Report Message';
      default:
        return `Report ${targetType}`;
    }
  };

  return createPortal(
    <div
      className={styles.overlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
    >
      <div className={styles.container} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitleGroup}>
            <svg
              className={styles.reportIcon}
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
            <h2 id="report-modal-title" className={styles.title}>
              {getTargetTitle()}
            </h2>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close modal"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className={styles.form}>
          {/* Target Preview Context */}
          {(targetName || targetPreview || targetAvatar) && (
            <div className={styles.previewCard}>
              {targetAvatar && (
                <img src={targetAvatar} alt="" className={styles.previewAvatar}  onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.png'; }} />
              )}
              <div className={styles.previewTextGroup}>
                {targetName && <div className={styles.previewName}>{targetName}</div>}
                {targetPreview && (
                  <div className={styles.previewSnippet}>"{targetPreview}"</div>
                )}
              </div>
            </div>
          )}

          <p className={styles.subtitle}>Why are you reporting this?</p>

          {/* Reason Radio Options */}
          <div className={styles.reasonsList}>
            {REPORT_REASONS.map((item) => (
              <label key={item.value} className={styles.reasonOption}>
                <input
                  type="radio"
                  value={item.value}
                  {...register('reason')}
                  className={styles.radioInput}
                />
                <span className={styles.radioCustom} />
                <span className={styles.reasonLabel}>{item.label}</span>
              </label>
            ))}
          </div>
          {errors.reason && (
            <p className={styles.fieldError}>{errors.reason.message}</p>
          )}

          {/* Optional / Required Description */}
          <div className={styles.descriptionSection}>
            <label htmlFor="report-description" className={styles.descriptionLabel}>
              Details {selectedReason === 'OTHER' ? <span className={styles.requiredTag}>*required</span> : '(optional)'}
            </label>
            <textarea
              id="report-description"
              rows={3}
              placeholder={
                selectedReason === 'OTHER'
                  ? 'Please explain why you are reporting this...'
                  : 'Add any extra details that will help our moderation team...'
              }
              {...register('description')}
              className={`${styles.textarea} ${errors.description ? styles.inputError : ''}`}
            />
            {errors.description && (
              <p className={styles.fieldError}>{errors.description.message}</p>
            )}
          </div>

          <div className={styles.footer}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={isPending}
            >
              {isPending ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
