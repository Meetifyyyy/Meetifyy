import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Cropper from 'react-easy-crop';
import { getCroppedImg } from './cropImageUtils';
import { X, Check, Loader2 } from 'lucide-react';
import { useOverlayBack } from '@shared/hooks/useOverlayBack';

export default function MediaCropper({ imageFile, aspect, cropShape = 'rect', onCropComplete, onCancel, onError }) {
  // Back dismisses this dialog rather than navigating the page behind it.
  useOverlayBack(true, onCancel);

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [imageSrc, setImageSrc] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  React.useEffect(() => {
    if (imageFile) {
      if (typeof imageFile === 'string') {
        setImageSrc(imageFile);
      } else {
        const url = URL.createObjectURL(imageFile);
        setImageSrc(url);
        return () => URL.revokeObjectURL(url);
      }
    }
  }, [imageFile]);

  const onCropCompleteHandler = useCallback((croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const [isClosing, setIsClosing] = useState(false);

  const handleSmoothClose = (callback) => {
    setIsClosing(true);
    setTimeout(() => {
      callback();
    }, 200);
  };

  const handleConfirm = async () => {
    if (isProcessing || isClosing) return;
    setIsProcessing(true);
    const startTime = Date.now();
    try {
      const croppedBlob = await getCroppedImg(imageSrc, croppedAreaPixels);
      if (!croppedBlob || croppedBlob.size === 0) {
        throw new Error('The browser could not create the cropped image. Please try another image.');
      }
      const fileName = (typeof imageFile === 'object' && imageFile?.name)
        ? imageFile.name.replace(/\.[^.]+$/, '.webp')
        : 'cropped.webp';
      const croppedFile = new File([croppedBlob], fileName, {
        type: 'image/webp',
        lastModified: Date.now(),
      });
      croppedFile.previewUrl = URL.createObjectURL(croppedBlob);

      // Mandatory 500ms minimum spinner animation display
      const elapsed = Date.now() - startTime;
      if (elapsed < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsed));
      }

      handleSmoothClose(() => onCropComplete(croppedFile));
    } catch (e) {
      const error = e instanceof Error
        ? e
        : new Error('Could not prepare this image. Please try another JPG, PNG, WebP, or GIF.');
      console.error('[media-cropper] crop failed:', error);
      handleSmoothClose(() => {
        if (onError) onError(error);
        else onCancel();
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!imageSrc) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        padding: '16px',
        boxSizing: 'border-box',
        transition: 'opacity 0.2s ease-in-out',
        opacity: isClosing ? 0 : 1
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing && !isClosing) {
          handleSmoothClose(onCancel);
        }
      }}
    >
      <div
        style={{
          background: 'var(--color-bg-white, #ffffff)',
          color: 'var(--color-text-main, #0f172a)',
          width: '100%',
          maxWidth: '540px',
          borderRadius: '24px',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
          border: 'none',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          position: 'relative',
          transition: 'transform 0.2s ease-in-out, opacity 0.2s ease-in-out',
          transform: isClosing ? 'scale(0.95)' : 'scale(1)',
          opacity: isClosing ? 0 : 1
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 20px 14px 20px'
          }}
        >
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text-main, #0f172a)' }}>
            Crop Image
          </h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '6px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--color-text-muted, #64748b)'
            }}
          >
            <X size={20} />
          </button>
        </div>
        
        {/* Cropper Area */}
        <div style={{ padding: '0 16px' }}>
          <style>{`
            .customSquircleCropArea {
              border-radius: 24px !important;
            }
            .react-easy-crop_crop-area {
              border-radius: ${cropShape === 'round' ? '50%' : '24px'} !important;
            }
          `}</style>
          <div style={{ position: 'relative', width: '100%', height: '340px', background: '#090d16', borderRadius: '16px', overflow: 'hidden' }}>
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onCropComplete={onCropCompleteHandler}
              onZoomChange={setZoom}
              objectFit="contain"
              cropShape={cropShape}
              classes={{
                cropAreaClassName: cropShape === 'round' ? '' : 'customSquircleCropArea'
              }}
              showGrid={true}
            />
          </div>
        </div>

        {/* Controls & Footer */}
        <div
          style={{
            padding: '16px 20px 20px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}
        >
          {/* Zoom Slider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-muted, #64748b)', minWidth: '40px' }}>
              Zoom
            </span>
            <input
              type="range"
              value={zoom}
              min={1}
              max={3}
              step={0.05}
              onChange={(e) => setZoom(Number(e.target.value))}
              style={{
                width: '100%',
                accentColor: 'var(--color-primary, #2563eb)',
                cursor: 'pointer'
              }}
            />
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button
              type="button"
              onClick={onCancel}
              disabled={isProcessing}
              style={{
                padding: '10px 18px',
                borderRadius: '12px',
                border: 'none',
                background: 'var(--color-bg-soft, #f1f5f9)',
                color: 'var(--color-text-main, #0f172a)',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isProcessing}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 20px',
                borderRadius: '12px',
                border: 'none',
                background: 'var(--color-primary, #2563eb)',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                opacity: isProcessing ? 0.75 : 1
              }}
            >
              {isProcessing ? (
                <>
                  <Loader2 size={18} style={{ animation: 'cropperSpin 0.9s linear infinite' }} />
                  <span>Cropping...</span>
                </>
              ) : (
                <>
                  <Check size={18} />
                  <span>Apply Crop</span>
                </>
              )}
            </button>
            <style>{`
              @keyframes cropperSpin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
