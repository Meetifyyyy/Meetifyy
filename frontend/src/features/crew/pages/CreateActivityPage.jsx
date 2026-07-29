import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import styles from './CreateActivityPage.module.css';

import ImageSearchModal from '@shared/components/modals/ImageSearchModal';

import { getRelativeDateLabel } from '@shared/utils/time';
import {
  ArrowLeft, Send, ImageIcon,
  MapPin, Users, Pencil, Bell, CalendarClock,
  ChevronLeft, ChevronRight, ChevronDown, X, Search, GraduationCap,
  BellOff, ChevronsUpDown, Eye, Link, Check
} from 'lucide-react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { activitiesApi, usersApi } from '@shared/api/apiClient';
import { useAuth } from '@shared/context/AuthContext';
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

  useLayoutEffect(() => {
    if (timeListRef.current && selectedSlotIdx >= 0) {
      const el = timeListRef.current.children[selectedSlotIdx];
      if (el) el.scrollIntoView({ block: 'center', behavior: 'auto' });
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
    const currentEnd   = getParsedDate(formData.endDateYear,   formData.endDateMonth,   formData.endDateDay,   formData.endTimeHour,   formData.endTimeMinute,   formData.endTimeAmPm);

    const MIN_MS  = 5  * 60 * 1000;   // 5 minutes
    const DEF_MS  = 60 * 60 * 1000;   // 1 hour (used when end would be invalid)
    const MAX_MS  = 30 * 24 * 60 * 60 * 1000;

    // Preserve existing duration — only reset to 1 hr if new start overtakes end
    let duration = (currentEnd && currentStart) ? currentEnd.getTime() - currentStart.getTime() : DEF_MS;
    const newEndCandidate = new Date(newStart.getTime() + duration);

    let newEnd;
    if (currentEnd && newEndCandidate.getTime() - newStart.getTime() >= MIN_MS) {
      // End is still safely ahead — keep the same duration
      newEnd = newEndCandidate;
    } else {
      // New start overtook (or nearly overtook) end — push end 1 hr ahead
      newEnd = new Date(newStart.getTime() + DEF_MS);
    }

    // Cap at 30-day maximum
    if (newEnd.getTime() - newStart.getTime() > MAX_MS) {
      newEnd = new Date(newStart.getTime() + MAX_MS);
    }

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
    if (currentStart) {
      const MIN_MS = 5 * 60 * 1000;
      if (newEnd.getTime() < currentStart.getTime() + MIN_MS) {
        newEnd = new Date(currentStart.getTime() + MIN_MS); // minimum 5 min gap
      }
      const maxEnd = new Date(currentStart.getTime() + 30 * 24 * 60 * 60 * 1000);
      if (newEnd.getTime() > maxEnd.getTime()) {
        newEnd = maxEnd;
      }
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

  const isDayDisabled = (day) => {
    const d = new Date(viewYear, viewMonth, day); d.setHours(0,0,0,0);
    const t = new Date(); t.setHours(0,0,0,0);
    if (isStart) {
      return d < t;
    } else {
      const currentStart = getParsedDate(formData.startDateYear, formData.startDateMonth, formData.startDateDay, formData.startTimeHour, formData.startTimeMinute, formData.startTimeAmPm);
      if (!currentStart) return d < t;
      const startDay = new Date(currentStart); startDay.setHours(0,0,0,0);
      const maxEndDay = new Date(currentStart.getTime() + 30 * 24 * 60 * 60000); maxEndDay.setHours(23,59,59,999);
      return d < startDay || d > maxEndDay;
    }
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
                  className={`${styles.calDay} ${day && isSelected(day) ? styles.calDaySel : ''} ${day && isDayDisabled(day) ? styles.calDayOff : ''}`}
                  onClick={() => day && !isDayDisabled(day) && pickDay(day)}
                  disabled={!day || isDayDisabled(day)}
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

/* ─── Post-publish Invite Modal ─── */
function ActivityCreatedModal({ activityTitle, creationPromise, onDone }) {
  const { currentUser } = useAuth();
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: friendsList = [], isLoading } = useQuery({
    queryKey: ['user-following-friends', currentUser?.username],
    queryFn: () => usersApi.getFollowing(currentUser?.username, 100, 0),
    enabled: !!currentUser?.username,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    if (!Array.isArray(friendsList)) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return friendsList;
    return friendsList.filter(u =>
      (u.displayName || '').toLowerCase().includes(q) ||
      (u.username || '').toLowerCase().includes(q)
    );
  }, [friendsList, searchQuery]);

  const toggle = (id) => setSelectedIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );

  // Awaits the in-flight creation promise, then sends invites
  const handleSend = async () => {
    setIsSending(true);
    try {
      const activity = await creationPromise;
      if (selectedIds.length > 0 && activity?.id) {
        await activitiesApi.inviteFriends(activity.id, selectedIds).catch(() => {});
      }
    } catch {
      // creation failed — navigate anyway
    }
    onDone();
  };

  const handleSkip = async () => {
    // still await so the cache is populated before we navigate
    await creationPromise.catch(() => {});
    onDone();
  };

  const handleCopy = async () => {
    try {
      const activity = await creationPromise;
      const url = `${window.location.origin}/crew/${activity?.id || ''}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.72)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1rem',
    }}>
      <div style={{
        background: 'rgba(24,24,27,0.96)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '20px',
        width: '100%',
        maxWidth: '420px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>

        {/* Header */}
        <div style={{ padding: '1.5rem 1.5rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div style={{
              width: 36, height: 36, borderRadius: '10px',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Check size={18} color="#fff" strokeWidth={2.5} />
            </div>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: '1rem', color: '#fff' }}>Activity published!</p>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)' }}>{activityTitle}</p>
            </div>
          </div>

          {/* Copy link */}
          <button
            onClick={handleCopy}
            style={{
              marginTop: '0.75rem',
              width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              padding: '0.6rem 1rem',
              borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: copied ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)',
              color: copied ? '#10b981' : 'rgba(255,255,255,0.8)',
              fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            {copied ? <Check size={15} /> : <Link size={15} />}
            {copied ? 'Link copied!' : 'Copy activity link'}
          </button>
        </div>

        {/* Friends list */}
        <div style={{ padding: '1rem 1.5rem 0.5rem', flexShrink: 0 }}>
          <p style={{ margin: '0 0 0.75rem', fontWeight: 600, fontSize: '0.88rem', color: 'rgba(255,255,255,0.7)' }}>
            Invite friends
          </p>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: '10px', padding: '0.5rem 0.75rem',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <Search size={14} color="rgba(255,255,255,0.35)" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search friends…"
              style={{
                flex: 1, background: 'none', border: 'none', outline: 'none',
                color: '#fff', fontSize: '0.85rem',
              }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 1.5rem' }}>
          {isLoading ? (
            <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.82rem', padding: '1rem 0' }}>Loading…</p>
          ) : filtered.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: '0.82rem', padding: '1rem 0' }}>No friends found</p>
          ) : filtered.map(u => {
            const sel = selectedIds.includes(u.id);
            return (
              <button
                key={u.id}
                onClick={() => toggle(u.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.6rem 0', background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <img
                    src={u.avatar || '/default_avatar.webp'}
                    alt=""
                    style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', background: '#333' }}
                  />
                  {sel && (
                    <span style={{
                      position: 'absolute', bottom: -2, right: -2,
                      width: 16, height: 16, borderRadius: '50%',
                      background: '#6366f1', border: '2px solid #18181b',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Check size={9} color="#fff" strokeWidth={3} />
                    </span>
                  )}
                </div>
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: '0.85rem', color: '#fff' }}>{u.displayName || u.username}</p>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)' }}>@{u.username}</p>
                </div>
                <div style={{
                  width: 22, height: 22, borderRadius: '6px', flexShrink: 0,
                  border: sel ? 'none' : '1.5px solid rgba(255,255,255,0.2)',
                  background: sel ? '#6366f1' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}>
                  {sel && <Check size={12} color="#fff" strokeWidth={2.5} />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', gap: '0.75rem',
        }}>
          <button
            onClick={handleSkip}
            style={{
              flex: 1, padding: '0.7rem', borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'transparent', color: 'rgba(255,255,255,0.6)',
              fontSize: '0.88rem', fontWeight: 500, cursor: 'pointer',
            }}
          >
            Skip
          </button>
          <button
            onClick={handleSend}
            disabled={isSending}
            style={{
              flex: 2, padding: '0.7rem', borderRadius: '10px',
              border: 'none',
              background: selectedIds.length > 0
                ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                : 'rgba(99,102,241,0.25)',
              color: selectedIds.length > 0 ? '#fff' : 'rgba(255,255,255,0.4)',
              fontSize: '0.88rem', fontWeight: 600, cursor: isSending ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            {isSending ? 'Sending…' : selectedIds.length > 0 ? `Invite ${selectedIds.length} friend${selectedIds.length > 1 ? 's' : ''}` : 'Invite friends'}
          </button>
        </div>

      </div>
    </div>
  );
}

export default function CreateActivityPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const prefill = location.state?.prefill || {};
  const returnTo = location.state?.returnTo || '/crew';
  const { currentUser, collegeName } = useAuth();
  const queryClient = useQueryClient();
  const today = new Date();

  const [showImageSearch, setShowImageSearch] = useState(false);
  const [showDT, setShowDT] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [showCapacity, setShowCapacity] = useState(false);
  const [showWhoCanJoin, setShowWhoCanJoin] = useState(false);
  const [hasInteractedWithDT, setHasInteractedWithDT] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const creationPromiseRef = useRef(null); // holds the in-flight create promise
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

    if (currentStart && currentEnd && (currentEnd.getTime() - currentStart.getTime() > 30 * 24 * 60 * 60000)) {
      currentEnd = new Date(currentStart.getTime() + 30 * 24 * 60 * 60000);
      const e = formatToState(currentEnd);
      const updates = {
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
  const isDurationOver30Days = (startD && endD) ? (endD.getTime() - startD.getTime() > 30 * 24 * 60 * 60000) : false;
  const isTitleValid = formData.title.trim().length > 0 && formData.title.trim().length <= 30;
  const isDescriptionValid = formData.description.length <= 500;
  const isLocationValid = formData.location.trim().length > 0 && formData.location.length <= 100;
  // Note: We don't block canPublish on isPast because we will auto-correct it on publish
  const canPublish = !!(isTitleValid && isDescriptionValid && isLocationValid && hasInteractedWithDT && startD && endD && !isEndBeforeStart && !isDurationOver30Days);

  const handlePublish = () => {
    if (!canPublish) return;
    const { startD: finalStart, endD: finalEnd, fd } = getCorrectedDates();
    if (finalEnd <= finalStart) return;

    // ── Optimistic update (Twitter/Instagram pattern) ──────────────────────
    // Inject a fake activity into the cache RIGHT NOW so it appears instantly
    // everywhere in the app. No loading, no waiting.
    const tempId = `optimistic_${Date.now()}`;
    const optimisticActivity = {
      id: tempId,
      _isOptimistic: true,
      title: formData.title,
      description: formData.description,
      location: fd.location,
      coverImage: formData.coverImage,
      startDate: finalStart.toISOString(),
      endDate: finalEnd.toISOString(),
      createdAt: new Date().toISOString(),
      creatorId: currentUser?.id,
      creator: currentUser,
      members: [{ userId: currentUser?.id, status: 'MEMBER', role: 'HOST', user: currentUser }],
      status: 'UPCOMING',
      createActivityGroup: fd.createEventGroup,
      maxMembers: fd.slotsNeeded === 999 ? null : fd.slotsNeeded,
    };

    // Snapshot current cache for rollback
    const previousCache = queryClient.getQueryData(['activities']);

    queryClient.setQueryData(['activities'], (old) => {
      if (!old?.pages) return old;
      const newPages = old.pages.map((page, i) => {
        if (i !== 0) return page;
        const acts = page?.activities ?? page ?? [];
        return Array.isArray(page?.activities)
          ? { ...page, activities: [optimisticActivity, ...acts] }
          : [optimisticActivity, ...acts];
      });
      return { ...old, pages: newPages };
    });

    // Show modal immediately — user browses friends while API runs in background
    setShowInviteModal(true);

    // ── Background API call ─────────────────────────────────────────────────
    creationPromiseRef.current = activitiesApi.create({
      title: formData.title,
      description: formData.description,
      location: fd.location,
      maxMembers: fd.slotsNeeded === 999 ? null : fd.slotsNeeded,
      coverImage: formData.coverImage,
      createActivityGroup: fd.createEventGroup,
      visibility: fd.whoCanJoin === 'College' ? 'COLLEGE_ONLY' : fd.whoCanJoin === 'No one' ? 'PRIVATE' : 'PUBLIC',
      shareToCampus: fd.whoCanJoin === 'College',
      startDate: finalStart.toISOString(),
      endDate: finalEnd.toISOString(),
    }).then((realActivity) => {
      // Swap optimistic entry with real server data
      queryClient.setQueryData(['activities'], (old) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page) => {
            const acts = page?.activities ?? page ?? [];
            const replaced = acts.map((a) => a.id === tempId ? realActivity : a);
            return Array.isArray(page?.activities)
              ? { ...page, activities: replaced }
              : replaced;
          }),
        };
      });
      return realActivity;
    }).catch((err) => {
      // Rollback — remove the optimistic entry
      queryClient.setQueryData(['activities'], previousCache);
      console.error('Failed to create activity', err);
      throw err;
    });
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
            <button className={styles.backBtn} onClick={() => navigate(returnTo, { replace: true })} aria-label="Go back">
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
              maxLength={500}
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
                maxLength={100}
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
                  <span>{formData.whoCanJoin === 'College' ? collegeName : formData.whoCanJoin}</span>
                  <ChevronsUpDown size={14} className={styles.selectIcon} />
                </div>
              </button>
              {showWhoCanJoin && (
                <div className={styles.reminderDrop}>
                  {['Anyone', 'College', 'No one'].map(opt => {
                    let label = opt;
                    if (opt === 'College') label = collegeName;
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
      {showInviteModal && (
        <ActivityCreatedModal
          activityTitle={formData.title}
          creationPromise={creationPromiseRef.current}
          onDone={() => navigate(returnTo, { replace: true })}
        />
      )}
    </main>
  );
}
