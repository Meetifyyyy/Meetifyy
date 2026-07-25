import React, { useState, useCallback, useRef } from 'react';
import Cropper from 'react-easy-crop';
import { getCroppedImg } from './cropImageUtils';
import { X, Check } from 'lucide-react';

export default function MediaCropper({ imageFile, aspect, onCropComplete, onCancel }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [imageSrc, setImageSrc] = useState(null);
  
  // Create object URL for the image file
  React.useEffect(() => {
    if (imageFile) {
      const url = URL.createObjectURL(imageFile);
      setImageSrc(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [imageFile]);

  const onCropCompleteHandler = useCallback((croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const handleConfirm = async () => {
    try {
      const croppedBlob = await getCroppedImg(imageSrc, croppedAreaPixels);
      
      // Convert blob back to File to maintain compatibility with mediaPipeline
      const croppedFile = new File([croppedBlob], imageFile.name, {
        type: 'image/jpeg', // getCroppedImg returns jpeg usually, or we can use the original type
        lastModified: Date.now(),
      });
      
      onCropComplete(croppedFile);
    } catch (e) {
      console.error(e);
      onCancel();
    }
  };

  if (!imageSrc) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-bg-primary w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl border border-border-primary flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-primary">
          <h3 className="text-text-primary font-semibold text-lg">Crop Image</h3>
          <button onClick={onCancel} className="p-2 rounded-full hover:bg-bg-secondary text-text-secondary transition-colors">
            <X size={20} />
          </button>
        </div>
        
        {/* Cropper Area */}
        <div className="relative w-full h-[60vh] bg-black">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            onCropChange={setCrop}
            onCropComplete={onCropCompleteHandler}
            onZoomChange={setZoom}
            objectFit="contain"
          />
        </div>

        {/* Footer Controls */}
        <div className="p-4 border-t border-border-primary flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <span className="text-text-secondary text-sm font-medium">Zoom</span>
            <input
              type="range"
              value={zoom}
              min={1}
              max={3}
              step={0.1}
              aria-labelledby="Zoom"
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-primary h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer"
            />
          </div>
          
          <div className="flex justify-end gap-3">
            <button
              onClick={onCancel}
              className="px-5 py-2 rounded-xl text-text-secondary font-medium hover:bg-bg-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-primary text-white font-medium hover:bg-primary-hover active:scale-95 transition-all shadow-md shadow-primary/20"
            >
              <Check size={18} />
              Apply Crop
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
