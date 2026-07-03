import { useState, useEffect } from 'react';
import { ACTIVITY_CATEGORIES } from './crewData';
import styles from './CreateActivityModal.module.css';
import { useData } from '../../context/DataContext';
import CustomSelect from '../common/CustomSelect';
import { getRelativeDateLabel } from '../../utils/time';

export default function CreateActivityModal({ isOpen, onClose, onPublish, initialData }) {
  const { currentUser } = useData();
  
  const today = new Date();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    category: '',
    customCategory: '',
    title: '',
    description: '',
    coverImage: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=1000&auto=format&fit=crop',
    tags: '',
    dateYear: '',
    dateMonth: '',
    dateDay: '',
    timeHour: '',
    timeMinute: '',
    timeAmPm: '',
    duration: '1 hour',
    location: '',
    isOnline: false,
    participationType: 'open',
    slotsNeeded: 2,
  });

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        const isStandard = ACTIVITY_CATEGORIES.includes(initialData.activity);
        
        let parsedSlots = 2;
        if (initialData.people === '2-3 People') parsedSlots = 3;
        if (initialData.people === 'Small Group (4-8)') parsedSlots = 5;
        
        setFormData(prev => ({
          ...prev,
          category: isStandard ? initialData.activity : (initialData.activity ? 'Other' : ''),
          customCategory: isStandard ? '' : (initialData.activity || ''),
          dateYear: today.getFullYear(),
          dateMonth: today.getMonth() + 1,
          dateDay: today.getDate(),
          location: (initialData.location === 'Current Location' || initialData.location === 'Custom Area') ? '' : (initialData.location || ''),
          slotsNeeded: parsedSlots
        }));
        
        if (initialData.activity) {
          setStep(2); // Skip category selection
        } else {
          setStep(1);
        }
      } else {
        setStep(1);
        setFormData({
          category: '',
          customCategory: '',
          title: '',
          description: '',
          coverImage: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=1000&auto=format&fit=crop',
          tags: '',
          dateYear: '',
          dateMonth: '',
          dateDay: '',
          timeHour: '',
          timeMinute: '',
          timeAmPm: '',
          duration: '1 hour',
          location: '',
          isOnline: false,
          participationType: 'open',
          slotsNeeded: 2,
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialData]);

  const getDaysInMonth = (year, month) => new Date(year, month, 0).getDate();
  const maxDays = getDaysInMonth(formData.dateYear, formData.dateMonth);

  useEffect(() => {
    if (formData.dateDay > maxDays) {
      setFormData(prev => ({ ...prev, dateDay: maxDays }));
    }
  }, [formData.dateYear, formData.dateMonth, maxDays, formData.dateDay]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const getSelectedDateTime = () => {
    let hour24 = parseInt(formData.timeHour, 10);
    if (formData.timeAmPm === 'PM' && hour24 !== 12) hour24 += 12;
    if (formData.timeAmPm === 'AM' && hour24 === 12) hour24 = 0;
    return new Date(formData.dateYear, formData.dateMonth - 1, formData.dateDay, hour24, parseInt(formData.timeMinute, 10));
  };

  const isPastDateTime = getSelectedDateTime() <= new Date();

  const canProceed = () => {
    switch(step) {
      case 1:
        if (formData.category === 'Other') return formData.customCategory.trim() !== '';
        return !!formData.category;
      case 2:
        return formData.title.trim() !== '' && formData.description.trim() !== '' && formData.tags.trim() !== '';
      case 3:
        if (!formData.dateYear || !formData.dateMonth || !formData.dateDay || !formData.timeHour || !formData.timeMinute || !formData.timeAmPm) return false;
        if (!formData.isOnline && formData.location.trim() === '') return false;
        return !isPastDateTime;
      case 4:
        return parseInt(formData.slotsNeeded, 10) >= 2;
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (canProceed()) setStep(prev => prev + 1);
  };
  const handleBack = () => setStep(prev => prev - 1);
  
  const handlePublish = () => {
    const selectedDate = new Date(formData.dateYear, formData.dateMonth - 1, formData.dateDay);
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const tomorrow = new Date(todayDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const dateStr = `${formData.dateYear}-${String(formData.dateMonth).padStart(2, '0')}-${String(formData.dateDay).padStart(2, '0')}`;
    const timeStr = `${String(formData.timeHour).padStart(2, '0')}:${String(formData.timeMinute).padStart(2, '0')} ${formData.timeAmPm}`;

    const newActivity = {
      id: `act_${Date.now()}`,
      hostId: currentUser?.id || 'current_user',
      hostName: currentUser?.displayName || 'You',
      hostUsername: currentUser?.username || 'currentUser',
      hostAvatar: currentUser?.avatar || '',
      hostCollege: currentUser?.university || 'University',
      hostVerified: true,
      category: formData.category === 'Other' ? formData.customCategory.trim() : formData.category,
      title: formData.title,
      description: formData.description,
      coverImage: formData.coverImage,
      tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
      dateLabel: getRelativeDateLabel(dateStr),
      date: dateStr,
      time: timeStr,
      duration: formData.duration,
      location: formData.location || (formData.isOnline ? 'Online' : 'TBD'),
      isOnline: formData.isOnline,
      participationType: formData.participationType,
      slotsNeeded: parseInt(formData.slotsNeeded, 10),
      slotsFilled: 1,
      participants: [currentUser?.id || 'current_user'],
      requests: []
    };
    onPublish(newActivity);
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;
  const currentDay = today.getDate();
  const currentHour24 = today.getHours();
  const currentMinute = today.getMinutes();

  const isToday = formData.dateYear === currentYear && formData.dateMonth === currentMonth && formData.dateDay === currentDay;

  const monthOptions = Array.from({length: 12}).map((_, i) => {
    const val = i + 1;
    const isDisabled = formData.dateYear === currentYear && val < currentMonth;
    return { 
      value: val, 
      label: new Date(2000, i, 1).toLocaleString('default', { month: 'long' }),
      disabled: isDisabled
    };
  });

  const dayOptions = Array.from({length: maxDays}).map((_, i) => {
    const val = i + 1;
    const isDisabled = formData.dateYear === currentYear && formData.dateMonth === currentMonth && val < currentDay;
    return { value: val, label: String(val), disabled: isDisabled };
  });

  const amPmOptions = [{ value: 'AM', label: 'AM' }, { value: 'PM', label: 'PM' }].map(opt => {
    const isDisabled = isToday && currentHour24 >= 12 && opt.value === 'AM';
    return { ...opt, disabled: isDisabled };
  });

  const hourOptions = Array.from({length: 12}).map((_, i) => {
    const h = String(i + 1).padStart(2, '0');
    let hour24 = parseInt(h, 10);
    if (formData.timeAmPm === 'PM' && hour24 !== 12) hour24 += 12;
    if (formData.timeAmPm === 'AM' && hour24 === 12) hour24 = 0;
    
    const isDisabled = isToday && hour24 < currentHour24;
    return { value: h, label: h, disabled: isDisabled };
  });

  const minuteOptions = Array.from({length: 12}).map((_, i) => {
    const m = String(i * 5).padStart(2, '0');
    let hour24 = parseInt(formData.timeHour, 10);
    if (formData.timeAmPm === 'PM' && hour24 !== 12) hour24 += 12;
    if (formData.timeAmPm === 'AM' && hour24 === 12) hour24 = 0;
    
    let isDisabled = false;
    if (isToday) {
      if (hour24 < currentHour24) isDisabled = true;
      else if (hour24 === currentHour24) isDisabled = parseInt(m, 10) <= currentMinute;
    }
    
    return { value: m, label: m, disabled: isDisabled };
  });

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <header className={styles.header}>
          <h2>Create Activity</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </header>

        <div className={styles.body}>
          {step === 1 && (
            <div className={styles.step}>
              <h3>Choose a Category</h3>
              <div className={styles.categories}>
                {[...ACTIVITY_CATEGORIES, 'Other'].map(cat => (
                  <button 
                    key={cat} 
                    className={`${styles.catBtn} ${formData.category === cat ? styles.active : ''}`}
                    onClick={() => setFormData({ ...formData, category: cat })}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              {formData.category === 'Other' && (
                <div style={{ marginTop: '1.5rem', animation: 'fadeIn 0.2s ease-out' }}>
                  <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: '600', marginBottom: '0.5rem', color: 'var(--color-text-main)' }}>Custom Category Name</label>
                  <input
                    type="text"
                    value={formData.customCategory}
                    onChange={(e) => setFormData({ ...formData, customCategory: e.target.value })}
                    placeholder="e.g. Board Games"
                    maxLength={20}
                    style={{ 
                      width: '100%', 
                      padding: '0.65rem 0.85rem', 
                      borderRadius: '10px', 
                      border: '1px solid var(--color-border)', 
                      outline: 'none', 
                      fontSize: '0.9rem',
                      background: 'var(--color-bg-main)',
                      color: 'var(--color-text-main)'
                    }}
                  />
                  <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.3rem' }}>
                    {formData.customCategory.length}/20
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className={styles.step}>
              <h3>Basic Information</h3>
              <div className={styles.formGroup}>
                <label>Title</label>
                <input 
                  type="text" 
                  value={formData.title} 
                  onChange={e => setFormData({...formData, title: e.target.value})}
                  placeholder="E.g., Weekend Cricket Match"
                />
              </div>
              <div className={styles.formGroup}>
                <label>Description</label>
                <textarea 
                  value={formData.description} 
                  onChange={e => setFormData({...formData, description: e.target.value})}
                  placeholder="What is this activity about?"
                  rows={4}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Tags (comma separated)</label>
                <input 
                  type="text" 
                  value={formData.tags} 
                  onChange={e => setFormData({...formData, tags: e.target.value})}
                  placeholder="e.g., sports, outdoor"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className={styles.step}>
              <h3>Location & Schedule</h3>
              <div className={styles.formGroup}>
                <label>Date</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <div style={{ flex: 1 }}>
                    <CustomSelect 
                      value={formData.dateDay} 
                      onChange={e => setFormData({...formData, dateDay: parseInt(e.target.value, 10)})}
                      options={dayOptions}
                      placeholder="DD"
                    />
                  </div>
                  <div style={{ flex: 1.5 }}>
                    <CustomSelect 
                      value={formData.dateMonth} 
                      onChange={e => setFormData({...formData, dateMonth: parseInt(e.target.value, 10)})}
                      options={monthOptions}
                      placeholder="Month"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <CustomSelect 
                      value={formData.dateYear} 
                      onChange={e => setFormData({...formData, dateYear: parseInt(e.target.value, 10)})}
                      options={[0, 1, 2, 3].map(offset => {
                        const y = today.getFullYear() + offset;
                        return { value: y, label: String(y) };
                      })}
                      placeholder="YYYY"
                    />
                  </div>
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Time</label>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <CustomSelect 
                      value={formData.timeHour} 
                      onChange={e => setFormData({...formData, timeHour: e.target.value})}
                      options={hourOptions}
                      placeholder="HH"
                    />
                  </div>
                  <span style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>:</span>
                  <div style={{ flex: 1 }}>
                    <CustomSelect 
                      value={formData.timeMinute} 
                      onChange={e => setFormData({...formData, timeMinute: e.target.value})}
                      options={minuteOptions}
                      placeholder="MM"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <CustomSelect 
                      value={formData.timeAmPm} 
                      onChange={e => setFormData({...formData, timeAmPm: e.target.value})}
                      options={amPmOptions}
                      placeholder="AM/PM"
                    />
                  </div>
                  <div style={{ flex: 0.5 }}></div>
                </div>
                {isPastDateTime && (
                  <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 500 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    Please select a future date and time.
                  </div>
                )}
              </div>
              <div className={styles.formGroup}>
                <label>Location</label>
                <input 
                  type="text" 
                  value={formData.location} 
                  onChange={e => setFormData({...formData, location: e.target.value})}
                  placeholder="Where is it happening?"
                />
              </div>
              <label className={styles.checkboxLabel}>
                <input 
                  type="checkbox" 
                  checked={formData.isOnline} 
                  onChange={e => setFormData({...formData, isOnline: e.target.checked})}
                />
                This is an online activity
              </label>
            </div>
          )}

          {step === 4 && (
            <div className={styles.step}>
              <h3>Participation</h3>
              <div className={styles.formGroup}>
                <label>Total Participants Needed</label>
                <input 
                  type="number" 
                  min="2"
                  value={formData.slotsNeeded} 
                  onChange={e => setFormData({...formData, slotsNeeded: e.target.value})}
                />
              </div>
              <div className={styles.formGroup}>
                <label>Join Method</label>
                <div className={styles.radioGroup}>
                  <label className={styles.radioLabel}>
                    <input 
                      type="radio" 
                      name="participationType"
                      value="open"
                      checked={formData.participationType === 'open'}
                      onChange={e => setFormData({...formData, participationType: e.target.value})}
                    />
                    <span><strong>Open:</strong> Anyone can join instantly</span>
                  </label>
                  <label className={styles.radioLabel}>
                    <input 
                      type="radio" 
                      name="participationType"
                      value="approval"
                      checked={formData.participationType === 'approval'}
                      onChange={e => setFormData({...formData, participationType: e.target.value})}
                    />
                    <span><strong>Approval:</strong> You review requests first</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className={styles.step}>
              <h3>Review & Publish</h3>
              <div className={styles.reviewCard}>
                <h4>{formData.title || 'Untitled Activity'}</h4>
                <p><strong>Category:</strong> {formData.category === 'Other' ? formData.customCategory : formData.category}</p>
                <p><strong>When:</strong> {formData.date} at {formData.time}</p>
                <p><strong>Where:</strong> {formData.location}</p>
                <p><strong>Participants:</strong> {formData.slotsNeeded} ({formData.participationType})</p>
              </div>
            </div>
          )}
        </div>

        <footer className={styles.footer}>
          {step > 1 ? (
            <button className={styles.backBtn} onClick={handleBack}>Back</button>
          ) : (
            <div /> // placeholder to keep flex alignment
          )}
          
          {step < 5 ? (
            <button 
              className={styles.nextBtn} 
              onClick={handleNext}
              disabled={!canProceed()}
            >
              Continue
            </button>
          ) : (
            <button className={styles.publishBtn} onClick={handlePublish}>
              Publish Activity
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
