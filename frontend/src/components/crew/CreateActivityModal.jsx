import { useState, useEffect } from 'react';
import styles from './CreateActivityModal.module.css';
import { useData } from '../../context/DataContext';
import CustomSelect from '../common/CustomSelect';
import { getRelativeDateLabel } from '../../utils/time';
import { 
  ArrowLeft, Send, Bell, Image as ImageIcon, GraduationCap, 
  MapPin, Users, Pencil, Trash2, Calendar, Clock, ChevronDown, ChevronRight, X 
} from 'lucide-react';
import owlBeThereImg from '../../assets/images/owl_be_there.png';

const PRESET_IMAGES = [
  { url: owlBeThereImg, label: 'Owl Be There' },
  { url: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?q=80&w=1000&auto=format&fit=crop', label: 'Study Group' },
  { url: 'https://images.unsplash.com/photo-1517649763962-0c623066013b?q=80&w=1000&auto=format&fit=crop', label: 'Sports' },
  { url: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=1000&auto=format&fit=crop', label: 'Social Party' },
  { url: 'https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?q=80&w=1000&auto=format&fit=crop', label: 'Board Games' },
];

export default function CreateActivityModal({ isOpen, onClose, onPublish, initialData }) {
  const { currentUser } = useData();
  
  const today = new Date();
  const [showImagePresets, setShowImagePresets] = useState(false);
  const [showDateSelect, setShowDateSelect] = useState(false);
  const [showTimeSelect, setShowTimeSelect] = useState(false);
  const [showReminderSelect, setShowReminderSelect] = useState(false);
  const [showCapacitySelect, setShowCapacitySelect] = useState(false);

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    coverImage: owlBeThereImg,
    dateYear: today.getFullYear(),
    dateMonth: today.getMonth() + 1,
    dateDay: today.getDate(),
    timeHour: '06',
    timeMinute: '30',
    timeAmPm: 'PM',
    duration: '2 hours',
    location: '',
    participationType: 'open',
    slotsNeeded: 999, // Unlimited
    shareToUniversity: true,
    reminder: 'None',
  });

  useEffect(() => {
    if (isOpen) {
      setShowImagePresets(false);
      setShowDateSelect(false);
      setShowTimeSelect(false);
      setShowReminderSelect(false);
      setShowCapacitySelect(false);

      if (initialData) {
        let parsedSlots = 999;
        if (initialData.people === '2-3 People') parsedSlots = 3;
        if (initialData.people === 'Small Group (4-8)') parsedSlots = 5;
        
        setFormData(prev => ({
          ...prev,
          dateYear: today.getFullYear(),
          dateMonth: today.getMonth() + 1,
          dateDay: today.getDate(),
          location: (initialData.location === 'Current Location' || initialData.location === 'Custom Area') ? '' : (initialData.location || ''),
          slotsNeeded: parsedSlots,
          coverImage: initialData.coverImage || owlBeThereImg,
          title: initialData.title || '',
          description: initialData.description || '',
        }));
      } else {
        setFormData({
          title: '',
          description: '',
          coverImage: owlBeThereImg,
          dateYear: today.getFullYear(),
          dateMonth: today.getMonth() + 1,
          dateDay: today.getDate(),
          timeHour: '06',
          timeMinute: '30',
          timeAmPm: 'PM',
          duration: '2 hours',
          location: '',
          participationType: 'open',
          slotsNeeded: 999,
          shareToUniversity: true,
          reminder: 'None',
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

  const canPublish = () => {
    if (!formData.title.trim()) return false;
    if (!formData.description.trim()) return false;
    if (!formData.location.trim()) return false;
    if (isPastDateTime) return false;
    return true;
  };

  const handlePublish = () => {
    if (!canPublish()) return;

    const dateStr = `${formData.dateYear}-${String(formData.dateMonth).padStart(2, '0')}-${String(formData.dateDay).padStart(2, '0')}`;
    const timeStr = `${String(formData.timeHour).padStart(2, '0')}:${String(formData.timeMinute).padStart(2, '0')} ${formData.timeAmPm}`;

    const newActivity = {
      id: `crew_${Date.now()}`,
      hostId: currentUser?.id || 'current_user',
      hostName: currentUser?.displayName || 'You',
      hostUsername: currentUser?.username || 'currentUser',
      hostAvatar: currentUser?.avatar || '',
      hostCollege: currentUser?.university || 'University',
      hostVerified: true,
      category: 'Social', // defaulted since category is removed from UI
      title: formData.title,
      description: formData.description,
      coverImage: formData.coverImage,
      tags: [], // defaulted since tags are removed from UI
      dateLabel: getRelativeDateLabel(dateStr),
      date: dateStr,
      time: timeStr,
      duration: formData.duration,
      location: formData.location,
      isOnline: false,
      participationType: formData.participationType,
      slotsNeeded: formData.slotsNeeded === 999 ? 999 : parseInt(formData.slotsNeeded, 10),
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
          <button className={styles.backBtn} onClick={onClose}>
            <ArrowLeft size={20} />
            <span>New event</span>
          </button>
          <button 
            className={`${styles.createBtn} ${canPublish() ? styles.active : ''}`}
            onClick={handlePublish}
            disabled={!canPublish()}
          >
            <Send size={14} />
            <span>Create</span>
          </button>
        </header>

        <div className={styles.body}>
          {/* Main Title Input */}
          <div className={styles.titleSection}>
            <input 
              type="text"
              value={formData.title}
              onChange={e => setFormData({ ...formData, title: e.target.value })}
              placeholder="Untitled event"
              className={styles.titleInput}
              maxLength={30}
            />
          </div>

          {/* Cover Image Section */}
          <div className={styles.imageSection}>
            {formData.coverImage ? (
              <div className={styles.coverImageContainer}>
                <img src={formData.coverImage} alt="Cover Preview" className={styles.coverImg} />
                <div className={styles.coverOverlays}>
                  <button 
                    type="button" 
                    className={styles.imageActionBtn}
                    onClick={() => setShowImagePresets(!showImagePresets)}
                  >
                    <Pencil size={14} />
                    <span>Edit image</span>
                  </button>
                  <button 
                    type="button" 
                    className={styles.imageActionBtn}
                    onClick={() => setFormData({ ...formData, coverImage: '' })}
                  >
                    <Trash2 size={14} />
                    <span>Remove</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.noImageContainer} onClick={() => setShowImagePresets(true)}>
                <ImageIcon size={32} />
                <span>Add cover image</span>
              </div>
            )}

            {/* Presets Panel */}
            {showImagePresets && (
              <div className={styles.presetsPanel}>
                <div className={styles.presetsHeader}>
                  <h4>Select a Cover Image</h4>
                  <button onClick={() => setShowImagePresets(false)} className={styles.iconOnlyBtn}>
                    <X size={16} />
                  </button>
                </div>
                <div className={styles.presetsGrid}>
                  {PRESET_IMAGES.map((img, idx) => (
                    <div 
                      key={idx} 
                      className={`${styles.presetItem} ${formData.coverImage === img.url ? styles.activePreset : ''}`}
                      onClick={() => {
                        setFormData({ ...formData, coverImage: img.url });
                        setShowImagePresets(false);
                      }}
                    >
                      <img src={img.url} alt={img.label} />
                      <span>{img.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Description Section */}
          <div className={styles.cardGroup}>
            <textarea 
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              placeholder="Add a description of your event"
              className={styles.descInput}
              rows={4}
            />
          </div>

          {/* Date & Time Selector */}
          <div className={styles.rowSelector} onClick={() => setShowDateSelect(!showDateSelect)}>
            <div className={styles.rowLabelGroup}>
              <Calendar size={18} className={styles.rowLucideIcon} />
              <span className={styles.rowTitle}>Date</span>
            </div>
            <div className={styles.rowValueGroup}>
              <span className={styles.rowValue}>
                {formData.dateDay ? `${formData.dateDay}/${formData.dateMonth}/${formData.dateYear}` : 'Select Date'}
              </span>
              <ChevronDown size={16} className={`${styles.chevron} ${showDateSelect ? styles.expanded : ''}`} />
            </div>
          </div>

          {showDateSelect && (
            <div className={styles.inlineExpandPanel}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <div style={{ flex: 1 }}>
                  <CustomSelect 
                    value={formData.dateDay} 
                    onChange={e => setFormData({...formData, dateDay: parseInt(e.target.value, 10)})}
                    options={dayOptions}
                    placeholder="Day"
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
                    placeholder="Year"
                  />
                </div>
              </div>
            </div>
          )}

          <div className={styles.rowSelector} onClick={() => setShowTimeSelect(!showTimeSelect)}>
            <div className={styles.rowLabelGroup}>
              <Clock size={18} className={styles.rowLucideIcon} />
              <span className={styles.rowTitle}>Time</span>
            </div>
            <div className={styles.rowValueGroup}>
              <span className={styles.rowValue}>
                {formData.timeHour ? `${formData.timeHour}:${formData.timeMinute} ${formData.timeAmPm}` : 'Select Time'}
              </span>
              <ChevronDown size={16} className={`${styles.chevron} ${showTimeSelect ? styles.expanded : ''}`} />
            </div>
          </div>

          {showTimeSelect && (
            <div className={styles.inlineExpandPanel}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <CustomSelect 
                    value={formData.timeHour} 
                    onChange={e => setFormData({...formData, timeHour: e.target.value})}
                    options={hourOptions}
                    placeholder="HH"
                  />
                </div>
                <span style={{ color: 'var(--color-text-main)' }}>:</span>
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
              </div>
              {isPastDateTime && (
                <div className={styles.pastDateAlert}>
                  Please select a future date and time.
                </div>
              )}
            </div>
          )}

          {/* Location Card */}
          <div className={styles.cardGroup}>
            <div className={styles.inputWithIconRow}>
              <MapPin size={18} className={styles.rowLucideIcon} />
              <input 
                type="text" 
                value={formData.location} 
                onChange={e => setFormData({...formData, location: e.target.value})}
                placeholder="Add a location"
                className={styles.textInputInline}
              />
            </div>
          </div>

          {/* Reminder Selector */}
          <div className={styles.rowSelector} onClick={() => setShowReminderSelect(!showReminderSelect)}>
            <div className={styles.rowLabelGroup}>
              <Bell size={18} className={styles.rowLucideIcon} />
              <span className={styles.rowTitle}>Reminder</span>
            </div>
            <div className={styles.rowValueGroup}>
              <span className={styles.rowValue}>{formData.reminder}</span>
              <ChevronDown size={16} className={`${styles.chevron} ${showReminderSelect ? styles.expanded : ''}`} />
            </div>
          </div>

          {showReminderSelect && (
            <div className={styles.inlineExpandPanel}>
              <div className={styles.reminderOptions}>
                {['None', '5 minutes before', '15 minutes before', '1 hour before', '1 day before'].map(rem => (
                  <button 
                    key={rem}
                    type="button"
                    className={`${styles.presetOptionBtn} ${formData.reminder === rem ? styles.presetOptionActive : ''}`}
                    onClick={() => {
                      setFormData({ ...formData, reminder: rem });
                      setShowReminderSelect(false);
                    }}
                  >
                    {rem}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* University/School Share Row */}
          <div className={styles.cardGroup}>
            <div className={styles.switchRow}>
              <div className={styles.rowLabelGroup}>
                <GraduationCap size={18} className={styles.rowLucideIcon} />
                <div className={styles.labelSubtextWrapper}>
                  <span className={styles.rowTitle}>
                    Share to {currentUser?.university || 'GLA University'}
                  </span>
                  <span className={styles.rowSubtext}>People at your school can find this</span>
                </div>
              </div>
              <label className={styles.switch}>
                <input 
                  type="checkbox" 
                  checked={formData.shareToUniversity} 
                  onChange={e => setFormData({ ...formData, shareToUniversity: e.target.checked })} 
                />
                <span className={styles.slider} />
              </label>
            </div>
          </div>

          {/* Capacity Selector */}
          <div className={styles.rowSelector} onClick={() => setShowCapacitySelect(!showCapacitySelect)}>
            <div className={styles.rowLabelGroup}>
              <Users size={18} className={styles.rowLucideIcon} />
              <span className={styles.rowTitle}>Capacity</span>
            </div>
            <div className={styles.rowValueGroup}>
              <span className={styles.rowValue}>
                {formData.slotsNeeded === 999 ? 'Unlimited' : `${formData.slotsNeeded} people`}
              </span>
              <ChevronRight size={16} className={styles.chevron} />
            </div>
          </div>

          {showCapacitySelect && (
            <div className={styles.inlineExpandPanel}>
              <div className={styles.capacityOptions}>
                {[
                  { label: 'Unlimited', value: 999 },
                  { label: '2 spots', value: 2 },
                  { label: '3 spots', value: 3 },
                  { label: '5 spots', value: 5 },
                  { label: '10 spots', value: 10 },
                  { label: '20 spots', value: 20 },
                ].map(opt => (
                  <button 
                    key={opt.value}
                    type="button"
                    className={`${styles.presetOptionBtn} ${formData.slotsNeeded === opt.value ? styles.presetOptionActive : ''}`}
                    onClick={() => {
                      setFormData({ ...formData, slotsNeeded: opt.value });
                      setShowCapacitySelect(false);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Join Method Selector */}
          <div className={styles.cardGroup}>
            <div className={styles.formGroupLabel}>JOIN METHOD</div>
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input 
                  type="radio" 
                  name="participationType"
                  value="open"
                  checked={formData.participationType === 'open'}
                  onChange={e => setFormData({...formData, participationType: e.target.value})}
                />
                <div className={styles.radioText}>
                  <strong>Open:</strong>
                  <span>Anyone can join instantly</span>
                </div>
              </label>
              <label className={styles.radioLabel}>
                <input 
                  type="radio" 
                  name="participationType"
                  value="approval"
                  checked={formData.participationType === 'approval'}
                  onChange={e => setFormData({...formData, participationType: e.target.value})}
                />
                <div className={styles.radioText}>
                  <strong>Approval:</strong>
                  <span>You review requests first</span>
                </div>
              </label>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

