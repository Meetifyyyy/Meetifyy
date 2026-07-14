import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import styles from './CreateActivityPage.module.css';
import { useData } from '@shared/context/DataContext';
import ImageSearchModal from '@shared/components/ImageSearchModal';
import { getRelativeDateLabel } from '@shared/utils/time';
import {
  ArrowLeft, Send, ImageIcon,
  MapPin, Users, Pencil, Bell, CalendarClock,
  ChevronLeft, ChevronRight, ChevronDown, X, Search, GraduationCap,
  BellOff, ChevronsUpDown, Eye
} from 'lucide-react';
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_OF_WEEK = ['S','M','T','W','T','F','S'];

function buildTimeSlots() {
  const slots = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) {
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const ampm = h < 12 ? 'am' : 'pm';
      slots.push({ h, m, label: `${hour12}:${String(m).padStart(2, '0')}${ampm}` });
    }
  }
  return slots;
}
const TIME_SLOTS = buildTimeSlots();

const REMINDER_OPTIONS = [
  { value: 'None', label: 'None' },
  { value: '5 min', label: '5 min before' },
  { value: '15 min', label: '15 min before' },
  { value: '30 min', label: '30 min before' },
  { value: '1 hour', label: '1 hour before' },
  { value: '1 day', label: '1 day before' },
];

/* ─── Date & Time Modal ─── */
function DateTimeModal({ formData, set, onClose }) {
  const [activeTab, setActiveTab] = useState('start'); // 'start' or 'end'
  const isStart = activeTab === 'start';

  const today = new Date();
  const [viewYear, setViewYear] = useState(isStart ? (formData.startDateYear || today.getFullYear()) : (formData.endDateYear || today.getFullYear()));
  const [viewMonth, setViewMonth] = useState((isStart ? (formData.startDateMonth || (today.getMonth() + 1)) : (formData.endDateMonth || (today.getMonth() + 1))) - 1);
  const timeListRef = useRef(null);

  useEffect(() => {
    const today = new Date();
    if (isStart) {
      setViewYear(formData.startDateYear || today.getFullYear());
      setViewMonth((formData.startDateMonth || (today.getMonth() + 1)) - 1);
    } else {
      setViewYear(formData.endDateYear || today.getFullYear());
      setViewMonth((formData.endDateMonth || (today.getMonth() + 1)) - 1);
    }
  }, [activeTab]);

  const selectedHour = isStart ? formData.startTimeHour : formData.endTimeHour;
  const selectedMinute = isStart ? formData.startTimeMinute : formData.endTimeMinute;
  const selectedAmPm = isStart ? formData.startTimeAmPm : formData.endTimeAmPm;

  const hasTimeSelected = !!selectedHour;

  const selectedH = hasTimeSelected
    ? (selectedAmPm === 'PM'
      ? (parseInt(selectedHour, 10) === 12 ? 12 : parseInt(selectedHour, 10) + 12)
      : (parseInt(selectedHour, 10) === 12 ? 0 : parseInt(selectedHour, 10)))
    : null;
  const selectedM = hasTimeSelected ? parseInt(selectedMinute, 10) : null;
  const selectedSlotIdx = hasTimeSelected ? TIME_SLOTS.findIndex(s => s.h === selectedH && s.m === selectedM) : -1;

  useEffect(() => {
    if (timeListRef.current && selectedSlotIdx >= 0) {
      const el = timeListRef.current.children[selectedSlotIdx];
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeTab, selectedSlotIdx]);

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const updateStartDate = (newStart) => {
    const currentStart = getParsedDate(formData.startDateYear, formData.startDateMonth, formData.startDateDay, formData.startTimeHour, formData.startTimeMinute, formData.startTimeAmPm);
    const currentEnd = getParsedDate(formData.endDateYear, formData.endDateMonth, formData.endDateDay, formData.endTimeHour, formData.endTimeMinute, formData.endTimeAmPm);
    
    let duration = (currentEnd && currentStart) ? currentEnd.getTime() - currentStart.getTime() : 60 * 60000;
    if (duration < 60 * 60000) duration = 60 * 60000; // minimum 1 hr
    if (duration > 30 * 24 * 60 * 60000) duration = 30 * 24 * 60 * 60000; // max 30 days
    
    const newEnd = new Date(newStart.getTime() + duration);
    const s = formatToState(newStart);
    const e = formatToState(newEnd);
    
    set({
      startDateYear: s.y, startDateMonth: s.m, startDateDay: s.d,
      startTimeHour: s.h, startTimeMinute: s.min, startTimeAmPm: s.ap,
      endDateYear: e.y, endDateMonth: e.m, endDateDay: e.d,
      endTimeHour: e.h, endTimeMinute: e.min, endTimeAmPm: e.ap,
    });
  };

  const updateEndDate = (newEnd) => {
    const currentStart = getParsedDate(formData.startDateYear, formData.startDateMonth, formData.startDateDay, formData.startTimeHour, formData.startTimeMinute, formData.startTimeAmPm);
    if (currentStart && newEnd.getTime() < currentStart.getTime() + 60 * 60000) {
      newEnd = new Date(currentStart.getTime() + 60 * 60000); // enforce min 1 hour duration
    }
    const e = formatToState(newEnd);
    set({
      endDateYear: e.y, endDateMonth: e.m, endDateDay: e.d,
      endTimeHour: e.h, endTimeMinute: e.min, endTimeAmPm: e.ap,
    });
  };

  const pickDay = (day) => {
    if (isStart) {
      const newStart = getParsedDate(viewYear, viewMonth + 1, day, formData.startTimeHour, formData.startTimeMinute, formData.startTimeAmPm);
      if (newStart) updateStartDate(newStart);
    } else {
      const newEnd = getParsedDate(viewYear, viewMonth + 1, day, formData.endTimeHour, formData.endTimeMinute, formData.endTimeAmPm);
      if (newEnd) updateEndDate(newEnd);
    }
  };

  const pickSlot = (slot) => {
    const h12 = slot.h === 0 ? 12 : slot.h > 12 ? slot.h - 12 : slot.h;
    const hourStr = String(h12).padStart(2, '0');
    const minuteStr = String(slot.m).padStart(2, '0');
    const ampmStr = slot.h < 12 ? 'AM' : 'PM';
    
    if (isStart) {
      const newStart = getParsedDate(formData.startDateYear, formData.startDateMonth, formData.startDateDay, hourStr, minuteStr, ampmStr);
      if (newStart) updateStartDate(newStart);
    } else {
      const newEnd = getParsedDate(formData.endDateYear, formData.endDateMonth, formData.endDateDay, hourStr, minuteStr, ampmStr);
      if (newEnd) updateEndDate(newEnd);
    }
  };

  const isPastDay = (day) => {
    const d = new Date(viewYear, viewMonth, day); d.setHours(0,0,0,0);
    const t = new Date(); t.setHours(0,0,0,0);
    return d < t;
  };

  const isSelected = (day) => {
    if (isStart) {
      return formData.startDateYear === viewYear && formData.startDateMonth === viewMonth + 1 && formData.startDateDay === day;
    } else {
      return formData.endDateYear === viewYear && formData.endDateMonth === viewMonth + 1 && formData.endDateDay === day;
    }
  };

  const fmtDate = (isStartVal) => {
    const y = isStartVal ? formData.startDateYear : formData.endDateYear;
    const m = isStartVal ? formData.startDateMonth : formData.endDateMonth;
    const d = isStartVal ? formData.startDateDay : formData.endDateDay;
    if (!d) return 'Select date';
    return new Date(y, m - 1, d)
      .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const fmtTime = (isStartVal) => {
    const h = isStartVal ? formData.startTimeHour : formData.endTimeHour;
    const min = isStartVal ? formData.startTimeMinute : formData.endTimeMinute;
    const ampm = isStartVal ? formData.startTimeAmPm : formData.endTimeAmPm;
    if (!h) return 'Select time';
    return `${h}:${min} ${ampm}`;
  };

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.dateTimeModal} onClick={e => e.stopPropagation()}>
        <div className={styles.dtHeader}>
          <span className={styles.dtTitle}>Date &amp; Time</span>
          <button className={styles.dtClose} onClick={onClose}><X size={16} /></button>
        </div>

        <div className={styles.dtRangeRow}>
          <button className={`${styles.dtRangeBox} ${isStart ? styles.dtRangeBoxActive : ''}`} onClick={() => setActiveTab('start')}>
            <span className={styles.dtRangeDate}>{fmtDate(true)}</span>
            <span className={styles.dtRangeTime}>{fmtTime(true)}</span>
          </button>
          
          <ChevronRight size={16} className={styles.dtRangeArrow} />
          
          <button className={`${styles.dtRangeBox} ${!isStart ? styles.dtRangeBoxActive : ''}`} onClick={() => setActiveTab('end')}>
            <span className={styles.dtRangeDate}>{fmtDate(false)}</span>
            <span className={styles.dtRangeTime}>{fmtTime(false)}</span>
          </button>
        </div>

        <div className={styles.dtBody}>
          <div className={styles.calSection}>
            <div className={styles.calNav}>
              <span className={styles.calLabel}>{MONTHS[viewMonth]} {viewYear}</span>
              <div className={styles.calBtns}>
                <button className={styles.calBtn} onClick={prevMonth}><ChevronLeft size={14} /></button>
                <button className={styles.calBtn} onClick={nextMonth}><ChevronRight size={14} /></button>
              </div>
            </div>
            <div className={styles.calGrid}>
              {DAYS_OF_WEEK.map((d, i) => <span key={i} className={styles.calDow}>{d}</span>)}
              {cells.map((day, i) => (
                <button key={i}
                  className={`${styles.calDay} ${day && isSelected(day) ? styles.calDaySel : ''} ${day && isPastDay(day) ? styles.calDayOff : ''}`}
                  onClick={() => day && !isPastDay(day) && pickDay(day)}
                  disabled={!day || isPastDay(day)}
                >{day || ''}</button>
              ))}
            </div>
          </div>

          <div className={styles.timeCol}>
            <div className={styles.timeList} ref={timeListRef}>
              {TIME_SLOTS.map((slot, i) => (
                <button key={i}
                  className={`${styles.timeSlot} ${hasTimeSelected && slot.h === selectedH && slot.m === selectedM ? styles.timeSlotOn : ''}`}
                  onClick={() => pickSlot(slot)}
                >{slot.label}</button>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.dtFooter}>
          <button className={styles.dtDone} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* ─── Capacity Modal ─── */
function CapacityModal({ value, onSave, onClose }) {
  const [input, setInput] = useState(value === 999 ? '' : String(value));
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const save = () => {
    const n = parseInt(input, 10);
    onSave((!n || n <= 0) ? 999 : n);
    onClose();
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.capModal} onClick={e => e.stopPropagation()}>
        <div className={styles.dtHeader}>
          <span className={styles.dtTitle}>Capacity</span>
          <button className={styles.dtClose} onClick={onClose}><X size={16} /></button>
        </div>
        <div className={styles.capBody}>
          <p className={styles.capHint}>Leave empty for unlimited</p>
          <input
            ref={inputRef}
            type="number"
            min="1"
            className={styles.capInput}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="∞"
            onKeyDown={e => e.key === 'Enter' && save()}
          />
        </div>
        <div className={styles.dtFooter}>
          <button className={styles.capResetBtn} onClick={() => { onSave(999); onClose(); }}>Unlimited</button>
          <button className={styles.capResetBtn} onClick={() => { onSave(2); onClose(); }}>One-on-one</button>
          <button className={styles.dtDone} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}



/* ═══════════════════════════════
   Main Page
═══════════════════════════════ */
const getParsedDate = (y, m, d, hStr, minStr, ampm) => {
  if (!d) return null;
  let h = parseInt(hStr, 10);
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return new Date(y, m - 1, d, h, parseInt(minStr, 10));
};

const formatToState = (d) => {
  let h12 = d.getHours() % 12 || 12;
  return {
    y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(),
    h: String(h12).padStart(2, '0'), min: String(d.getMinutes()).padStart(2, '0'),
    ap: d.getHours() < 12 ? 'AM' : 'PM'
  };
};

const getInitialDates = () => {
  const now = new Date();
  const remainder = 5 - (now.getMinutes() % 5);
  const start = new Date(now.getTime() + (remainder === 5 ? 0 : remainder) * 60000);
  const end = new Date(start.getTime() + 60 * 60000); // +1 hour

  const s = formatToState(start), e = formatToState(end);
  return {
    startDateYear: s.y, startDateMonth: s.m, startDateDay: s.d,
    startTimeHour: s.h, startTimeMinute: s.min, startTimeAmPm: s.ap,
    endDateYear: e.y, endDateMonth: e.m, endDateDay: e.d,
    endTimeHour: e.h, endTimeMinute: e.min, endTimeAmPm: e.ap,
  };
};

const RANDOM_COVERS = [
  'https://images.unsplash.com/photo-1540575467063-178a50c2df87?q=80&w=800&auto=format&fit=crop', // Event crowd
  'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?q=80&w=800&auto=format&fit=crop', // Concert
  'https://images.unsplash.com/photo-1511556532299-8f662fc26c06?q=80&w=800&auto=format&fit=crop', // Tech setup
  'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?q=80&w=800&auto=format&fit=crop', // Meetup
  'https://images.unsplash.com/photo-1528605248644-14dd04022da1?q=80&w=800&auto=format&fit=crop', // Workshop
  'https://images.unsplash.com/photo-1551818255-e6e10975bc17?q=80&w=800&auto=format&fit=crop', // Tech event
];
const getRandomCover = () => RANDOM_COVERS[Math.floor(Math.random() * RANDOM_COVERS.length)];

export default function CreateActivityPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = location.state?.prefill || {};
  const returnTo = location.state?.returnTo || '/crew';
  const { currentUser, addCrewActivity } = useData();
  const today = new Date();

  const [showImageSearch, setShowImageSearch] = useState(false);
  const [showDT, setShowDT] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [showCapacity, setShowCapacity] = useState(false);
  const [showWhoCanJoin, setShowWhoCanJoin] = useState(false);
  const [hasInteractedWithDT, setHasInteractedWithDT] = useState(false);
  const reminderRef = useRef(null);
  const whoCanJoinRef = useRef(null);
  const containerRef = useRef(null);

  const [formData, setFormData] = useState({
    title: prefill.title || '',
    description: '',
    coverImage: prefill.coverImage || getRandomCover(),
    ...getInitialDates(),
    location: '',
    slotsNeeded: 999,
    reminder: 'None',
    createEventGroup: false,
    whoCanJoin: 'College',
  });

  const set = p => setFormData(prev => ({ ...prev, ...p }));

  useEffect(() => {
    const coverImage = formData.coverImage;
    if (!coverImage) return;

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = coverImage;
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 10;
        canvas.height = 10;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 10, 10);
        const data = ctx.getImageData(0, 0, 10, 10).data;

        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i+1];
          b += data[i+2];
          count++;
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);

        if (containerRef.current) {
          containerRef.current.style.setProperty('--extracted-rgb', `${r}, ${g}, ${b}`);
        }
      } catch (e) {
        console.warn('Failed to extract dominant color from cover image:', e);
      }
    };
  }, [formData.coverImage]);

  // close reminder dropdown on outside click
  useEffect(() => {
    if (!showReminder) return;
    const handler = (e) => { if (reminderRef.current && !reminderRef.current.contains(e.target)) setShowReminder(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showReminder]);

  // close who can join dropdown on outside click
  useEffect(() => {
    if (!showWhoCanJoin) return;
    const handler = (e) => { if (whoCanJoinRef.current && !whoCanJoinRef.current.contains(e.target)) setShowWhoCanJoin(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showWhoCanJoin]);

  const getStartDateTime = () => {
    return getParsedDate(formData.startDateYear, formData.startDateMonth, formData.startDateDay, formData.startTimeHour, formData.startTimeMinute, formData.startTimeAmPm);
  };

  const getEndDateTime = () => {
    return getParsedDate(formData.endDateYear, formData.endDateMonth, formData.endDateDay, formData.endTimeHour, formData.endTimeMinute, formData.endTimeAmPm);
  };

  const getDurationString = (start, end) => {
    if (!start || !end) return '';
    const diffMs = end - start;
    if (diffMs <= 0) return '0 mins';
    const diffMins = Math.round(diffMs / 60000);
    const hrs = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    if (hrs === 0) return `${mins} min${mins !== 1 ? 's' : ''}`;
    if (mins === 0) return `${hrs} hour${hrs !== 1 ? 's' : ''}`;
    return `${hrs}h ${mins}m`;
  };

  const getCorrectedDates = () => {
    let currentStart = getStartDateTime();
    let currentEnd = getEndDateTime();
    const now = new Date();
    
    if (currentStart && currentStart <= now) {
      let duration = (currentEnd && currentStart) ? currentEnd.getTime() - currentStart.getTime() : 60 * 60000;
      if (duration < 60 * 60000) duration = 60 * 60000;

      const remainder = 5 - (now.getMinutes() % 5);
      currentStart = new Date(now.getTime() + (remainder === 5 ? 0 : remainder) * 60000);
      currentEnd = new Date(currentStart.getTime() + duration);

      const s = formatToState(currentStart);
      const e = formatToState(currentEnd);

      const updates = {
        startDateYear: s.y, startDateMonth: s.m, startDateDay: s.d,
        startTimeHour: s.h, startTimeMinute: s.min, startTimeAmPm: s.ap,
        endDateYear: e.y, endDateMonth: e.m, endDateDay: e.d,
        endTimeHour: e.h, endTimeMinute: e.min, endTimeAmPm: e.ap,
      };
      set(updates);
      return { startD: currentStart, endD: currentEnd, fd: { ...formData, ...updates } };
    }
    return { startD: currentStart, endD: currentEnd, fd: formData };
  };

  const startD = getStartDateTime();
  const endD = getEndDateTime();
  const isEndBeforeStart = (startD && endD) ? endD <= startD : false;
  // Note: We don't block canPublish on isPast because we will auto-correct it on publish
  const canPublish = !!(formData.title.trim() && formData.location.trim() && hasInteractedWithDT && startD && endD && !isEndBeforeStart);

  const handlePublish = () => {
    if (!canPublish) return;
    const { startD: finalStart, endD: finalEnd, fd } = getCorrectedDates();
    if (finalEnd <= finalStart) return;
    
    const dateStr = `${fd.startDateYear}-${String(fd.startDateMonth).padStart(2, '0')}-${String(fd.startDateDay).padStart(2, '0')}`;
    const timeStr = `${String(fd.startTimeHour).padStart(2, '0')}:${String(fd.startTimeMinute).padStart(2, '0')} ${fd.startTimeAmPm}`;
    
    addCrewActivity({
      id: `crew_${Date.now()}`,
      hostId: currentUser?.id || 'current_user',
      hostName: currentUser?.displayName || 'You',
      hostUsername: currentUser?.username || 'currentUser',
      hostAvatar: currentUser?.avatar || '',
      hostCollege: currentUser?.university || 'University',
      hostVerified: true,
      category: 'Social',
      title: formData.title,
      description: formData.description,
      coverImage: formData.coverImage,
      tags: [],
      dateLabel: getRelativeDateLabel(dateStr),
      date: dateStr, 
      time: timeStr,
      endDate: `${fd.endDateYear}-${String(fd.endDateMonth).padStart(2, '0')}-${String(fd.endDateDay).padStart(2, '0')}`,
      endTime: `${String(fd.endTimeHour).padStart(2, '0')}:${String(fd.endTimeMinute).padStart(2, '0')} ${fd.endTimeAmPm}`,
      duration: getDurationString(finalStart, finalEnd),
      location: fd.location,
      isOnline: false,
      participationType: 'open',
      slotsNeeded: fd.slotsNeeded,
      slotsFilled: 1,
      participants: [currentUser?.id || 'current_user'],
      requests: [],
      createEventGroup: fd.createEventGroup,
      shareToSchool: fd.whoCanJoin === 'College',
    });
    navigate(returnTo);
  };

  const fmtDateTime = () => {
    const startD = getStartDateTime();
    const endD = getEndDateTime();
    if (!startD) return 'Select date & time';
    
    const formatTime = (h, m, ampm) => `${parseInt(h, 10)}:${m} ${ampm}`;
    const formatMonthDay = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const formatFullDate = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    const startTimeStr = formatTime(formData.startTimeHour, formData.startTimeMinute, formData.startTimeAmPm);
    if (!endD) return `${formatFullDate(startD)} • ${startTimeStr}`;

    const endTimeStr = formatTime(formData.endTimeHour, formData.endTimeMinute, formData.endTimeAmPm);

    const isSameDay = startD.toDateString() === endD.toDateString();
    const isSameYear = startD.getFullYear() === endD.getFullYear();

    if (isSameDay) {
      return `${formatMonthDay(startD)} • ${startTimeStr} – ${endTimeStr}`;
    } else if (isSameYear) {
      return `${formatMonthDay(startD)} • ${startTimeStr} → ${formatMonthDay(endD)} • ${endTimeStr}`;
    } else {
      return `${formatFullDate(startD)} • ${startTimeStr} → ${formatFullDate(endD)} • ${endTimeStr}`;
    }
  };

  return (
    <main ref={containerRef} data-theme="dark" className={styles.root}>
      {/* Blurred ambient background from cover image */}
      {formData.coverImage && (
        <div className={styles.ambientBg}>
          <img src={formData.coverImage} alt="" className={styles.ambientImg} />
        </div>
      )}
      
      <div className={styles.glass}>
        {/* ── Top bar ── */}
        <header className={styles.topBar}>
          <div className={styles.headerLeft}>
            <button className={styles.backBtn} onClick={() => navigate(returnTo)} aria-label="Go back">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
            <span className={styles.headerTitle}>New activity</span>
          </div>

          <div className={styles.rightActions}>
            <button
              className={`${styles.publishBtn} ${canPublish ? styles.publishOn : ''}`}
              onClick={handlePublish}
              disabled={!canPublish}
            >
              <Send size={13} />
              <span>Publish</span>
            </button>
          </div>
        </header>

        {/* ── Content ── */}
        <div className={styles.body}>

          {/* Mobile Title (hidden on desktop) */}
          <div className={styles.mobileTitle}>
            <input
              type="text"
              className={styles.fieldInput}
              value={formData.title}
              onChange={e => set({ title: e.target.value })}
              placeholder="Untitled activity"
              maxLength={30}
            />
          </div>

          {/* LEFT — 1:1 image */}
          <div className={styles.imgCol}>
            <div className={styles.imgSquare}>
              {formData.coverImage
                ? <img src={formData.coverImage} alt="Cover" className={styles.coverImg} />
                : <div className={styles.imgEmpty}><ImageIcon size={28} /><span>Add cover</span></div>
              }
              <button className={styles.changeBtn} onClick={() => setShowImageSearch(true)}>
                <Pencil size={11} />
                <span>{formData.coverImage ? 'Change' : 'Add'}</span>
              </button>
            </div>
          </div>

          {/* RIGHT — form fields */}
          <div className={styles.formCol}>

            {/* Desktop Title (hidden on mobile) */}
            <div className={styles.desktopTitle}>
              <input
                type="text"
                className={styles.fieldInput}
                value={formData.title}
                onChange={e => set({ title: e.target.value })}
                placeholder="Untitled activity"
                maxLength={30}
              />
            </div>

            {/* Description */}
            <textarea
              className={styles.fieldTextarea}
              value={formData.description}
              onChange={e => set({ description: e.target.value })}
              placeholder="Add a description"
              rows={4}
            />

            {/* Date & Time button */}
            <button className={styles.fieldBtn} onClick={() => { getCorrectedDates(); setShowDT(true); setHasInteractedWithDT(true); }}>
              <CalendarClock size={15} />
              {!hasInteractedWithDT ? (
                <span className={styles.fieldBtnLabel}>Date &amp; Time</span>
              ) : (
                <span className={styles.fieldBtnValue} style={{ marginLeft: 0, textAlign: 'left', flex: 1, color: '#ffffff' }}>{fmtDateTime()}</span>
              )}
              <ChevronRight size={14} style={{ marginLeft: 'auto' }} />
            </button>
            {isEndBeforeStart && (
              <div style={{ color: 'rgba(255, 100, 100, 0.9)', fontSize: '0.75rem', marginTop: '0.2rem', paddingLeft: '0.5rem', marginBottom: '0.2rem' }}>
                End time must be after start time.
              </div>
            )}

            {/* Location */}
            <div className={styles.locRow}>
              <MapPin size={15} className={styles.locIcon} />
              <input
                type="text"
                className={styles.locInput}
                value={formData.location}
                onChange={e => set({ location: e.target.value })}
                placeholder="Add location"
              />
            </div>

            {/* Reminder Row */}
            <div className={styles.reminderWrap} ref={reminderRef}>
              <button 
                type="button"
                className={styles.reminderRow} 
                onClick={() => setShowReminder(!showReminder)}
              >
                <div className={styles.rowLeft}>
                  {formData.reminder === 'None' ? (
                    <BellOff size={16} className={styles.rowIcon} />
                  ) : (
                    <Bell size={16} className={styles.rowIcon} />
                  )}
                  <span className={styles.rowTitle}>Reminder</span>
                </div>
                <div className={styles.rowRight}>
                  <span>{formData.reminder === 'None' ? 'None' : formData.reminder}</span>
                  <ChevronsUpDown size={14} className={styles.selectIcon} />
                </div>
              </button>
              {showReminder && (
                <div className={styles.reminderDrop}>
                  {REMINDER_OPTIONS.map(o => (
                    <button key={o.value}
                      className={`${styles.reminderOpt} ${formData.reminder === o.value ? styles.reminderOptOn : ''}`}
                      onClick={() => { set({ reminder: o.value }); setShowReminder(false); }}
                    >{o.label}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Event Group Toggle */}
            <div className={styles.toggleRow}>
              <div className={styles.toggleLabel}>
                <span className={styles.toggleTitle}>Create an activity group</span>
                <span className={styles.toggleDesc}>Create a shared chat and space for participants</span>
              </div>
              <label className={styles.switch}>
                <input
                  type="checkbox"
                  checked={formData.createEventGroup}
                  onChange={e => set({ createEventGroup: e.target.checked })}
                />
                <span className={styles.slider}></span>
              </label>
            </div>

            {/* Share to University */}
            <div style={{ position: 'relative', width: '100%', marginTop: '1.25rem' }} ref={whoCanJoinRef}>
              <button 
                type="button"
                className={styles.reminderRow} 
                onClick={() => setShowWhoCanJoin(!showWhoCanJoin)}
              >
                <div className={styles.rowLeft}>
                  <Eye size={16} className={styles.rowIcon} />
                  <span className={styles.rowTitle}>Who can see this activity</span>
                </div>
                <div className={styles.rowRight}>
                  <span>{formData.whoCanJoin === 'College' ? (currentUser?.university || 'GLA University') : formData.whoCanJoin}</span>
                  <ChevronsUpDown size={14} className={styles.selectIcon} />
                </div>
              </button>
              {showWhoCanJoin && (
                <div className={styles.reminderDrop}>
                  {['Anyone', 'College', 'No one'].map(opt => {
                    let label = opt;
                    if (opt === 'College') label = currentUser?.university || 'GLA University';
                    return (
                      <button key={opt}
                        className={`${styles.reminderOpt} ${formData.whoCanJoin === opt ? styles.reminderOptOn : ''}`}
                        onClick={() => { set({ whoCanJoin: opt }); setShowWhoCanJoin(false); }}
                      >{label}</button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Capacity Card */}
            <div style={{ width: '100%', marginTop: '1.25rem' }}>
              <button type="button" className={styles.reminderRow} onClick={() => setShowCapacity(true)}>
                <div className={styles.rowLeft}>
                  <Users size={16} className={styles.rowIcon} />
                  <span className={styles.rowTitle}>Capacity</span>
                </div>
                <div className={styles.rowRight}>
                  <span>{formData.slotsNeeded === 999 ? 'Unlimited' : (formData.slotsNeeded === 2 ? 'One-on-one' : `Total ${formData.slotsNeeded} people`)}</span>
                  <ChevronRight size={15} />
                </div>
              </button>
            </div>

          </div>
        </div>
      </div>

      {/* Modals */}
      {showImageSearch && (
        <ImageSearchModal 
          onClose={() => setShowImageSearch(false)}
          onSelect={(url) => { set({ coverImage: url }); setShowImageSearch(false); }}
        />
      )}
      {showDT && <DateTimeModal formData={formData} set={set} onClose={() => setShowDT(false)} />}
      {showCapacity && (
        <CapacityModal
          value={formData.slotsNeeded}
          onSave={n => set({ slotsNeeded: n })}
          onClose={() => setShowCapacity(false)}
        />
      )}
    </main>
  );
}
