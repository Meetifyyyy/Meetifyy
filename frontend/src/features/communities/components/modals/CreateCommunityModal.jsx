import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { normalizeMultilineText } from '@shared/utils/communityText';
import { createPortal } from 'react-dom';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';
import { useScrollLock } from '@shared/hooks/useScrollLock';
import { showToast } from '@shared/utils/toast';
import { blockIfOffline, submitErrorMessage } from '@shared/lib/offlineGuard';
import { isNetworkLevelFailure } from '@shared/utils/networkErrors';
import { useAuth } from '@shared/context/AuthContext';
import { openVerificationModal } from '@shared/stores/verificationModalStore';
import styles from './CreateCommunityModal.module.css';
import {
  COMMUNITY_DESCRIPTION_MAX,
  limitLineBreaks,
  isValidCommunityDescription,
} from '@shared/constants/communityLimits';
import { useCommunityActions } from '@shared/hooks/useCommunityActions';
import { processAndUploadImage } from '@shared/utils/mediaPipeline';
import {
  MAX_COVERED_IMAGE_SIZE_BYTES,
  COVERED_IMAGE_SIZE_ERROR_MESSAGE,
  ALLOWED_IMAGE_ACCEPT,
} from '@shared/constants/mediaLimits';
import { generateInitialAvatarFile } from '@shared/utils/generateAvatarImage';
import { createGestureSpring, rubberBand } from '@shared/lib/gestureSpring';
import { useCampusAffiliation } from '@shared/hooks/useCampusAffiliation';

const colors26 = [
  'linear-gradient(135deg, #FF6B6B, #FF8E53)',
  'linear-gradient(135deg, #4E65FF, #92EFFD)',
  'linear-gradient(135deg, #11998e, #38ef7d)',
  'linear-gradient(135deg, #FC466B, #3F5EFB)',
  'linear-gradient(135deg, #7F00FF, #E100FF)',
  'linear-gradient(135deg, #ff007f, #ff00ff)',
  'linear-gradient(135deg, #00c6ff, #0072ff)',
  'linear-gradient(135deg, #f857a6, #ff5858)',
  'linear-gradient(135deg, #eb3c5a, #f67280)',
  'linear-gradient(135deg, #56ab2f, #a8e063)',
  'linear-gradient(135deg, #F3904F, #3B4371)',
  'linear-gradient(135deg, #30CFD0, #330867)',
  'linear-gradient(135deg, #ee9ca7, #ffdde1)',
  'linear-gradient(135deg, #C33764, #1D2671)',
  'linear-gradient(135deg, #0f2027, #203a43)',
  'linear-gradient(135deg, #3a7bd5, #3a6073)',
  'linear-gradient(135deg, #1cd8d2, #93edc7)',
  'linear-gradient(135deg, #4ca1af, #c4e0e5)',
  'linear-gradient(135deg, #2c3e50, #bdc3c7)',
  'linear-gradient(135deg, #f4c4f3, #fc67fa)',
  'linear-gradient(135deg, #e65c00, #F9D423)',
  'linear-gradient(135deg, #2193b0, #6dd5ed)',
  'linear-gradient(135deg, #cc2b5e, #753a88)',
  'linear-gradient(135deg, #ec008c, #fc6767)',
  'linear-gradient(135deg, #1488C8, #2B32B2)',
  'linear-gradient(135deg, #e96443, #904e95)'
];

const categories = [
  { id: 'coding', label: 'Technology', icon: '💻' },
  { id: 'coding', label: 'Programming', icon: '👨‍💻' },
  { id: 'ai', label: 'Artificial Intelligence', icon: '🤖' },
  { id: 'design', label: 'Design', icon: '🎨' },
  { id: 'art', label: 'Art', icon: '🖌️' },
  { id: 'startup', label: 'Business & Startups', icon: '💼' },
  { id: 'science', label: 'Science', icon: '🔬' },
  { id: 'coding', label: 'Engineering', icon: '⚙️' },
  { id: 'education', label: 'Academics', icon: '📚' },
  { id: 'career', label: 'Career', icon: '💼' },
  { id: 'gaming', label: 'Gaming', icon: '🎮' },
  { id: 'other', label: 'Anime & Manga', icon: '🌸' },
  { id: 'other', label: 'Memes & Humor', icon: '😂' },
  { id: 'music', label: 'Music', icon: '🎵' },
  { id: 'photography', label: 'Photography', icon: '📸' },
  { id: 'photography', label: 'Videography', icon: '🎥' },
  { id: 'film', label: 'Movies & TV', icon: '🎬' },
  { id: 'sports', label: 'Sports', icon: '⚽' },
  { id: 'health', label: 'Fitness', icon: '💪' },
  { id: 'travel', label: 'Travel', icon: '✈️' },
  { id: 'food', label: 'Food', icon: '🍕' },
  { id: 'fashion', label: 'Fashion', icon: '👗' },
  { id: 'books', label: 'Books & Literature', icon: '📖' },
  { id: 'pets', label: 'Pets & Animals', icon: '🐶' },
  { id: 'other', label: 'Volunteering', icon: '🤝' },
  { id: 'education', label: 'Campus Life', icon: '🎓' },
  { id: 'startup', label: 'Entrepreneurship', icon: '🚀' },
  { id: 'other', label: 'Content Creation', icon: '🎥' },
  { id: 'language', label: 'Languages', icon: '🌍' },
  { id: 'health', label: 'Health & Wellness', icon: '🩺' },
  { id: 'other', label: 'Lifestyle', icon: '🌿' },
  { id: 'other', label: 'Other', icon: '✨' }
];

/** Characters a community name may use. `&` is allowed ("Robotics & AI"). */
const COMMUNITY_NAME_PATTERN = /^[a-zA-Z0-9\s.,!?'"()&-]+$/;

export default function CreateCommunityModal({ onClose, onCreated, isCampusCommunity = false }) {
  const { currentUser } = useAuth();
  const { addCommunity } = useCommunityActions();

  // Wizard Steps state
  const [step, setStep] = useState(1);

  /**
   * Back steps through the wizard, and only closes it from step one.
   *
   * Before this, Back left the Campus page entirely and dropped the user
   * wherever they had been before it — the modal did close, but only as a side
   * effect of the route changing underneath it, which is not what "close the
   * modal" means. The cause was `useOverlayBack` defaulting to not pushing a
   * history entry; with the entry pushed, the press is intercepted here and
   * the route is never touched.
   *
   * Same transition as the modal's own Back button, so the two are
   * interchangeable.
   */
  const handleWizardBack = useCallback(() => {
    if (step <= 1) return false;
    setStep((s) => s - 1);
    return true;
  }, [step]);

  useOverlayBack(true, onClose, { onBack: handleWizardBack });
  // Background stays put while this dialog is open. Counted, so a
  // dialog opened on top of another cannot unlock the page when it closes.
  useScrollLock(true);

  useEffect(() => {
    if (currentUser?.verificationStatus !== 'VERIFIED') {
      openVerificationModal('Verify with a live selfie to create a community.');
      onClose();
    }
  }, [currentUser?.verificationStatus, onClose]);

  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [selectedCat, setSelectedCat] = useState(null);
  const [privacy, setPrivacy] = useState(isCampusCommunity ? 'campus' : 'public');
  const { isActive: hasVerifiedCollege, status: collegeStatus } = useCampusAffiliation();
  // No verified college (known, not still loading): Campus is not on offer.
  useEffect(() => {
    if (collegeStatus === 'none' && privacy === 'campus') setPrivacy('public');
  }, [collegeStatus, privacy]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Avatar crop & upload state
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [cropState, setCropState] = useState({ x: 0, y: 0, zoom: 1 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  // Fixed gradient background for letter avatar fallback
  const [gradient] = useState(() => colors26[Math.floor(Math.random() * colors26.length)]);

  const fileInputRef = useRef(null);
  const nameInputRef = useRef(null);
  // The crop area: its pointer handlers are below (Crop drag).
  const cropperRef = useRef(null);
  // The avatar this submission already uploaded, keyed by what produced it
  // ({ signature, finalAvatar, hasCustomAvatar }). A retry after a lost
  // response must send the byte-identical body, or the idempotency key changes
  // and the server creates a second community. Uploading again on every submit
  // gave each attempt a new URL; reusing the earlier result keeps the body, and
  // so the key, the same. A different picture, crop, name or colour has a
  // different signature and is uploaded afresh.
  const avatarUploadRef = useRef(null);

  // Auto-focus name input when step 2 is active
  useEffect(() => {
    if (step === 2 && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [step]);

  // Validations
  const isCategoryValid = useMemo(() => {
    return selectedCat !== null;
  }, [selectedCat]);

  // Why the name cannot be used yet, or null. Shown under the field: the
  // Continue button used to just stay grey with nothing saying why.
  const nameProblem = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return null; // nothing typed yet is not an error
    if (trimmed.length < 3) return 'Use at least 3 characters.';
    if (trimmed.length > 30) return 'Use 30 characters or fewer.';
    if (!COMMUNITY_NAME_PATTERN.test(trimmed)) {
      return 'Use letters, numbers, spaces and . , ! ? \' " ( ) & - only.';
    }
    return null;
  }, [name]);
  const isNameValid = name.trim().length > 0 && nameProblem === null;

  const isDescValid = useMemo(() => {
    return isValidCommunityDescription(normalizeMultilineText(desc));
  }, [desc]);

  const isStep2Valid = useMemo(() => {
    return isNameValid && isDescValid;
  }, [isNameValid, isDescValid]);

  // Handle file inputs
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      showToast('Invalid image format', 'error');
      return;
    }

    if (file.size > MAX_COVERED_IMAGE_SIZE_BYTES) {
      showToast(COVERED_IMAGE_SIZE_ERROR_MESSAGE, 'error');
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setAvatarFile(file);
    setAvatarPreview(previewUrl);
    setCropState({ x: 0, y: 0, zoom: 1 });

    const img = new Image();
    img.src = previewUrl;
    img.onload = () => {
      setImageSize({ width: img.width, height: img.height });
    };
  };


  const handleZoomChange = (newZoom) => {
    const currentW = baseDimensions.w * newZoom;
    const currentH = baseDimensions.h * newZoom;
    const maxX = Math.max(0, (currentW - 150) / 2);
    const maxY = Math.max(0, (currentH - 150) / 2);

    setCropState(prev => ({
      zoom: newZoom,
      x: Math.max(-maxX, Math.min(maxX, prev.x)),
      y: Math.max(-maxY, Math.min(maxY, prev.y))
    }));
  };

  const baseDimensions = useMemo(() => {
    if (!imageSize.width || !imageSize.height) return { w: 150, h: 150 };
    const aspect = imageSize.width / imageSize.height;
    if (aspect > 1) {
      return { w: 150 * aspect, h: 150 };
    } else {
      return { w: 150, h: 150 / aspect };
    }
  }, [imageSize]);

  // ── Crop drag ──────────────────────────────────────────────────────────────
  // While the finger is down the picture follows it 1:1, written straight onto
  // the <img> (no React render per move). Past the edge of the crop it
  // stretches instead of stopping dead; on release it springs back inside and
  // the final position is committed to state once.
  const cropImgRef = useRef(null);
  const cropDrag = useRef(null);
  const cropLive = useRef({ x: 0, y: 0 });
  const cropSprings = useRef(null);

  const paintCrop = useCallback(() => {
    const img = cropImgRef.current;
    if (!img) return;
    const { x, y } = cropLive.current;
    img.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${cropState.zoom})`;
  }, [cropState.zoom]);

  const cropBounds = useCallback(() => ({
    maxX: Math.max(0, (baseDimensions.w * cropState.zoom - 150) / 2),
    maxY: Math.max(0, (baseDimensions.h * cropState.zoom - 150) / 2),
  }), [baseDimensions, cropState.zoom]);

  const getCropSprings = () => {
    if (!cropSprings.current) {
      cropSprings.current = {
        x: createGestureSpring((v) => { cropLive.current.x = v; paintCropRef.current(); }, { stiffness: 600 }),
        y: createGestureSpring((v) => { cropLive.current.y = v; paintCropRef.current(); }, { stiffness: 600 }),
      };
    }
    return cropSprings.current;
  };
  const paintCropRef = useRef(paintCrop);
  useEffect(() => { paintCropRef.current = paintCrop; }, [paintCrop]);
  useEffect(() => () => { cropSprings.current?.x.stop(); cropSprings.current?.y.stop(); }, []);

  /** Inside the bounds 1:1; past them, a rubber band. */
  const stretchCrop = (v, max) => {
    if (v > max) return max + rubberBand(v - max, 40);
    if (v < -max) return -max - rubberBand(-max - v, 40);
    return v;
  };

  const handleCropPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const springs = getCropSprings();
    // Caught while springing back: continue from where it visibly is.
    const from = springs.x.isMoving() || springs.y.isMoving()
      ? { x: springs.x.value(), y: springs.y.value() }
      : { x: cropState.x, y: cropState.y };
    springs.x.stop();
    springs.y.stop();
    cropLive.current = from;
    cropDrag.current = { id: e.pointerId, x0: e.clientX - from.x, y0: e.clientY - from.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handleCropPointerMove = (e) => {
    const d = cropDrag.current;
    if (!d || d.id !== e.pointerId) return;
    const { maxX, maxY } = cropBounds();
    cropLive.current = {
      x: stretchCrop(e.clientX - d.x0, maxX),
      y: stretchCrop(e.clientY - d.y0, maxY),
    };
    paintCrop();
  };

  const handleCropPointerEnd = (e) => {
    const d = cropDrag.current;
    if (!d || d.id !== e.pointerId) return;
    cropDrag.current = null;
    const { maxX, maxY } = cropBounds();
    const { x, y } = cropLive.current;
    const end = {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
    // State gets the final position once. Stretched past an edge, a spring
    // carries the picture back first and commits when it lands, so React's
    // own render of the transform never cuts the spring short.
    const commit = () => setCropState((prev) => ({ ...prev, ...end }));
    if (end.x === x && end.y === y) { commit(); return; }
    const springs = getCropSprings();
    const instant = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let landed = 0;
    const both = () => { landed += 1; if (landed === 2) commit(); };
    springs.x.set(x);
    springs.y.set(y);
    springs.x.to(end.x, { instant, done: both });
    springs.y.to(end.y, { instant, done: both });
  };

  // Unverified users get nothing — but this bail-out has to sit BELOW every
  // hook. It used to run before the useState calls, so the moment
  // verificationStatus flipped, the render went from ~11 hooks to 0 and React
  // threw "Rendered fewer hooks than expected", taking the tree down. The
  // accompanying effect above still closes the modal and prompts for
  // verification; this only decides what gets painted.
  if (currentUser?.verificationStatus !== 'VERIFIED') {
    return null;
  }

  // Export File Blob from canvas
  const getCroppedAvatarFile = () => {
    return new Promise((resolve) => {
      if (!avatarPreview) {
        resolve(avatarFile || null);
        return;
      }

      const img = new Image();
      img.src = avatarPreview;
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 256;
          canvas.height = 256;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(avatarFile || null);
            return;
          }

          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, 256, 256);

          const scaleFactor = 256 / 150;
          const targetW = baseDimensions.w * cropState.zoom * scaleFactor;
          const targetH = baseDimensions.h * cropState.zoom * scaleFactor;
          const targetX = 128 + cropState.x * scaleFactor - targetW / 2;
          const targetY = 128 + cropState.y * scaleFactor - targetH / 2;

          ctx.drawImage(img, targetX, targetY, targetW, targetH);
          canvas.toBlob((blob) => {
            if (!blob) {
              resolve(avatarFile || null);
              return;
            }
            const file = new File([blob], 'community-avatar.jpg', { type: 'image/jpeg' });
            resolve(file);
          }, 'image/jpeg', 0.9);
        } catch (e) {
          console.warn('Canvas cropping fallback:', e);
          resolve(avatarFile || null);
        }
      };
      img.onerror = () => {
        resolve(avatarFile || null);
      };
    });
  };

  // Submit and create community
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!isCategoryValid || !isStep2Valid) return;
    // Offline, before the avatar upload: the wizard stays on this step with
    // everything entered, and nothing starts that could hang or half-finish.
    if (blockIfOffline('community')) return;

    setIsSubmitting(true);
    try {
      // Only ever a real uploaded media reference, never a placeholder.
      //
      // This used to be seeded with the community's initial letter
      // (name.charAt(0)) and sent as `avatarKey`, so a community created without
      // a picture stored "H" or "J" in a column meant to hold a storage object
      // key. Every render then requested /api/media/H, which the backend
      // correctly rejected as a malformed key (400) on each paint.
      //
      // The initial is presentation, not data: Avatar already derives it from
      // `name` when there is no image, so nothing needs to be persisted.
      let finalAvatar = null;
      let hasCustomAvatar = false;

      // Custom picture: the selection (its object URL is unique per pick), the
      // crop and the source size decide the uploaded image. Generated default:
      // the name and the gradient do.
      const avatarSignature = avatarPreview
        ? JSON.stringify(['custom', avatarPreview, cropState.x, cropState.y, cropState.zoom, imageSize.width, imageSize.height])
        : JSON.stringify(['default', name.trim(), gradient]);
      const cachedAvatar = avatarUploadRef.current;

      if (cachedAvatar && cachedAvatar.signature === avatarSignature) {
        finalAvatar = cachedAvatar.finalAvatar;
        hasCustomAvatar = cachedAvatar.hasCustomAvatar;
      } else {
        if (avatarPreview) {
          const croppedFile = await getCroppedAvatarFile();
          if (croppedFile) {
            const { publicUrl } = await processAndUploadImage(croppedFile, 'communities', { maxWidthOrHeight: 512 });
            finalAvatar = publicUrl;
            hasCustomAvatar = true;
          }
        }

        if (!finalAvatar) {
          // No picture chosen: render the letter-and-gradient placeholder the user
          // just previewed into a real image and store it like any upload, so the
          // community owns an actual avatar URL from the moment it exists.
          //
          // Generated ONCE, here. Every surface then reads the stored URL, so the
          // avatar cannot drift between screens or change on a refresh the way a
          // per-render placeholder would. `gradient` is the same value shown in the
          // preview above, so what was on screen is what gets saved.
          //
          // Best-effort: a canvas or upload failure must not stop the community
          // being created. finalAvatar simply stays null and the existing
          // coloured-initial fallback keeps rendering, exactly as before.
          try {
            const generated = await generateInitialAvatarFile(name.trim(), gradient, {
              fileNameBase: 'community-default-avatar',
            });
            const { publicUrl } = await processAndUploadImage(generated, 'communities', { maxWidthOrHeight: 512 });
            if (publicUrl) finalAvatar = publicUrl;
          } catch (avatarErr) {
            console.warn('Default community avatar could not be generated; falling back to the rendered initial', avatarErr);
          }
        }
        avatarUploadRef.current = { signature: avatarSignature, finalAvatar, hasCustomAvatar };
      }

      const id = await addCommunity({
        name: name.trim(),
        description: normalizeMultilineText(desc),
        desc: normalizeMultilineText(desc),
        avatarKey: finalAvatar,
        avatar: finalAvatar,
        color: gradient,
        categoryLabel: `${selectedCat.icon} ${selectedCat.label}`,
        categories: [selectedCat.id],
        privacy: privacy,
        hasCustomAvatar,
        // What was chosen, never quietly downgraded: the server refuses Campus
        // without a verified college (with a reason that is shown), whereas
        // dropping it here made a public community out of a campus request.
        isCampusCommunity: isCampusCommunity || privacy === 'campus'
      });

      // Created: the next community is a new submission with its own upload.
      avatarUploadRef.current = null;
      onCreated(id);
    } catch (err) {
      // A 400 carries a reason written for the person (e.g. Campus without a
      // college email); anything else stays generic.
      const reason = err?.status === 400 && typeof err.message === 'string' ? err.message : null;
      showToast(
        isNetworkLevelFailure(err) ? submitErrorMessage(err) : (reason || "Couldn't create community"),
        'error',
      );
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Continue wizard navigation
  const handleContinue = () => {
    if (step === 1 && isCategoryValid) {
      setStep(2);
    } else if (step === 2 && isStep2Valid) {
      setStep(3);
    } else if (step === 3) {
      setStep(4);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (step < 4) {
        handleContinue();
      } else if (step === 4 && isCategoryValid && isStep2Valid && !isSubmitting) {
        handleSubmit();
      }
    }
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Absolute-positioned Close Button */}
        <button onClick={onClose} className={styles.closeButton} aria-label="Close modal">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Steps Body */}
        <div className={styles.stepWrapper}>
          {step === 1 && (
            <>
              <div className={styles.stepTitleGroup}>
                <h3 className={styles.stepTitle}>What will your community be about?</h3>
                <p className={styles.stepSubtitle}>Choose a topic to help people discover your community.</p>
              </div>

              <div className={styles.fieldGroup}>
                <div className={styles.categoryGrid}>
                  {categories.map((cat, idx) => {
                    const isSelected = selectedCat?.label === cat.label;
                    return (
                      <button
                        key={`${cat.label}-${idx}`}
                        type="button"
                        onClick={() => setSelectedCat(cat)}
                        aria-pressed={isSelected}
                        className={`${styles.categoryCard} ${isSelected ? styles.categoryCardSelected : ''}`}
                      >
                        <span>{cat.icon}</span>
                        <span>{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className={styles.stepTitleGroup}>
                <h3 className={styles.stepTitle}>Create your community</h3>
                <p className={styles.stepSubtitle}>Choose a name and description that clearly explains your community.</p>
              </div>

              <div className={styles.fieldGroup}>
                <div className={styles.inputWrap}>
                  <input
                    ref={nameInputRef}
                    type="text"
                    placeholder=" "
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={handleKeyDown}
                    maxLength={30}
                    aria-invalid={nameProblem ? true : undefined}
                    aria-describedby={nameProblem ? 'community-name-problem' : undefined}
                    className={styles.textInput}
                  />
                  <label className={styles.fieldLabel}>Name</label>
                </div>
                <div className={styles.counterRow}>
                  {nameProblem && (
                    <span id="community-name-problem" className={styles.fieldProblem} role="alert">{nameProblem}</span>
                  )}
                  {name.length}/30
                </div>
              </div>

              <div className={styles.fieldGroup}>
                <div className={styles.inputWrap}>
                  <textarea
                    placeholder=" "
                    value={desc}
                    onChange={(e) => setDesc(limitLineBreaks(e.target.value))}
                    rows={3}
                    maxLength={COMMUNITY_DESCRIPTION_MAX}
                    className={styles.textareaInput}
                  />
                  <label className={styles.textareaLabel}>Description</label>
                </div>
                <div className={styles.counterRow}>{normalizeMultilineText(desc).length}/{COMMUNITY_DESCRIPTION_MAX}</div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className={styles.stepTitleGroup}>
                <h3 className={styles.stepTitle}>Set an icon for your community</h3>
                <p className={styles.stepSubtitle}>Upload an image or keep the default gradient icon.</p>
              </div>

              <div className={styles.fieldGroup} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_IMAGE_ACCEPT}
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />

                {!avatarPreview ? (
                  <div className={styles.avatarSection}>
                    <div
                      className={styles.letterAvatar}
                      style={{ background: gradient, cursor: 'pointer' }}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {name.trim() ? name.trim().charAt(0).toUpperCase() : '?'}
                    </div>
                    <button type="button" className={styles.uploadTriggerButton} onClick={() => fileInputRef.current?.click()}>
                      <svg className={styles.uploadTriggerIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      Upload Image
                    </button>
                  </div>
                ) : (
                  <div className={styles.avatarSection}>
                    <div
                      ref={cropperRef}
                      className={styles.cropperWrapper}
                      // The drag owns every touch here: no page scroll, no zoom.
                      style={{ touchAction: 'none' }}
                      onPointerDown={handleCropPointerDown}
                      onPointerMove={handleCropPointerMove}
                      onPointerUp={handleCropPointerEnd}
                      onPointerCancel={handleCropPointerEnd}
                    >
                      <img
                        ref={cropImgRef}
                        draggable={false}
                        src={avatarPreview}
                        alt="Crop preview"
                        className={styles.cropperImage}
                        style={{
                          width: `${baseDimensions.w}px`,
                          height: `${baseDimensions.h}px`,
                          transform: `translate(-50%, -50%) translate(${cropState.x}px, ${cropState.y}px) scale(${cropState.zoom})`
                        }}
                       onError={(e) => { e.target.onerror = null; e.target.src = '/default_avatar.svg'; }} />
                    </div>
                    <div className={styles.zoomSliderRow}>
                      <span className={styles.zoomIcon}>🔍</span>
                      <input
                        type="range"
                        min="1"
                        max="3"
                        step="0.05"
                        value={cropState.zoom}
                        onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
                        className={styles.zoomInput}
                      />
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                          setAvatarPreview(null);
                          setAvatarFile(null);
                        }}
                        className={styles.removePhotoBtn}
                      >
                        Remove photo
                      </button>
                  </div>
                )}
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <div className={styles.stepTitleGroup}>
                <h3 className={styles.stepTitle}>Who can join?</h3>
                <p className={styles.stepSubtitle}>Choose privacy settings for your community.</p>
              </div>

              <div className={styles.privacyContainer}>
                <button
                  type="button"
                  onClick={() => setPrivacy('public')}
                  className={`${styles.privacyCard} ${privacy === 'public' ? styles.privacyCardSelected : ''}`}
                >
                  <div className={styles.privacyIcon}>🌐</div>
                  <div className={styles.privacyText}>
                    <div className={styles.privacyLabel}>Public</div>
                    <div className={styles.privacyDesc}>Anyone can view and join this community.</div>
                  </div>
                  <div className={styles.radioCircle}>
                    <div className={styles.radioDot} />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setPrivacy('private')}
                  className={`${styles.privacyCard} ${privacy === 'private' ? styles.privacyCardSelected : ''}`}
                >
                  <div className={styles.privacyIcon}>🔒</div>
                  <div className={styles.privacyText}>
                    <div className={styles.privacyLabel}>Private</div>
                    <div className={styles.privacyDesc}>Only approved members can view posts and join.</div>
                  </div>
                  <div className={styles.radioCircle}>
                    <div className={styles.radioDot} />
                  </div>
                </button>

                {/* Campus restricts the community to the creator's college, so it
                    is offered only to someone with a verified one (the server
                    refuses it otherwise). */}
                {hasVerifiedCollege && (
                <button
                  type="button"
                  onClick={() => setPrivacy('campus')}
                  className={`${styles.privacyCard} ${privacy === 'campus' ? styles.privacyCardSelected : ''}`}
                >
                  <div className={styles.privacyIcon}>🎓</div>
                  <div className={styles.privacyText}>
                    <div className={styles.privacyLabel}>Campus</div>
                    <div className={styles.privacyDesc}>Visible only to students in your college. Appears on the Campus page.</div>
                  </div>
                  <div className={styles.radioCircle}>
                    <div className={styles.radioDot} />
                  </div>
                </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer Navigation */}
        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            {step > 1 && (
              <button type="button" onClick={() => setStep(step - 1)} className={styles.buttonBack}>
                Back
              </button>
            )}
          </div>

          <div className={styles.footerCenter}>
            <div className={styles.dotsProgress}>
              {[1, 2, 3, 4].map((s) => (
                <div key={s} className={`${styles.dot} ${step === s ? styles.dotActive : ''}`} />
              ))}
            </div>
          </div>

          <div className={styles.footerRight}>
            {step < 4 ? (
              <button
                type="button"
                onClick={handleContinue}
                disabled={step === 1 ? !isCategoryValid : !isStep2Valid}
                className={styles.buttonContinue}
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className={styles.buttonCreate}
              >
                {isSubmitting ? (
                  <>
                    <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px', borderColor: 'currentColor', borderTopColor: 'transparent' }} />
                    Creating...
                  </>
                ) : (
                  'Create'
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
