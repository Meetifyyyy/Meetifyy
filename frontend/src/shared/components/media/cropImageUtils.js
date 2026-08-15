export const createImage = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
    image.setAttribute('crossOrigin', 'anonymous') // needed to avoid cross-origin issues
    image.src = url
  })

export function getRadianAngle(degreeValue) {
  return (degreeValue * Math.PI) / 180
}

/**
 * Returns the new bounding area of a rotated rectangle.
 */
export function rotateSize(width, height, rotation) {
  const rotRad = getRadianAngle(rotation)

  return {
    width:
      Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height:
      Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  }
}

/**
 * This function was adapted from the one in the ReadMe of https://github.com/DominicTobias/react-image-crop
 */
export async function getCroppedImg(
  imageSrc,
  pixelCrop,
  rotation = 0,
  flip = { horizontal: false, vertical: false },
  maxOutputDimension = 1920,
) {
  const image = await createImage(imageSrc)
  if (!pixelCrop || !pixelCrop.width || !pixelCrop.height) {
    throw new Error('The crop area was not ready. Please try the image again.')
  }

  // Event posters never expose rotation controls. Drawing the source crop
  // directly avoids allocating a full-resolution intermediate canvas (often
  // hundreds of MB for modern phone photos), which was causing crop failures
  // before the upload pipeline ever started.
  if (rotation === 0 && !flip.horizontal && !flip.vertical) {
    const scale = Math.min(1, maxOutputDimension / Math.max(pixelCrop.width, pixelCrop.height))
    const outputWidth = Math.max(1, Math.round(pixelCrop.width * scale))
    const outputHeight = Math.max(1, Math.round(pixelCrop.height * scale))
    const croppedCanvas = document.createElement('canvas')
    const croppedCtx = croppedCanvas.getContext('2d')
    if (!croppedCtx) throw new Error('Image cropping is not supported by this browser.')

    croppedCanvas.width = outputWidth
    croppedCanvas.height = outputHeight
    croppedCtx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      outputWidth,
      outputHeight,
    )

    return new Promise((resolve, reject) => {
      croppedCanvas.toBlob((blob) => {
        if (!blob || blob.size === 0) {
          reject(new Error('The browser could not create the cropped image. Please try another image.'))
          return
        }
        resolve(blob)
      }, 'image/webp', 0.92)
    })
  }

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image cropping is not supported by this browser.')

  const rotRad = getRadianAngle(rotation)

  // calculate bounding box of the rotated image
  const { width: bBoxWidth, height: bBoxHeight } = rotateSize(
    image.width,
    image.height,
    rotation
  )

  // set canvas size to match the bounding box
  canvas.width = bBoxWidth
  canvas.height = bBoxHeight

  // translate canvas context to a central location to allow rotating and flipping around the center
  ctx.translate(bBoxWidth / 2, bBoxHeight / 2)
  ctx.rotate(rotRad)
  ctx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1)
  ctx.translate(-image.width / 2, -image.height / 2)

  // draw rotated image
  ctx.drawImage(image, 0, 0)

  const croppedCanvas = document.createElement('canvas')
  const croppedCtx = croppedCanvas.getContext('2d')

  if (!croppedCtx) throw new Error('Image cropping is not supported by this browser.')

  // Set the size of the cropped canvas
  croppedCanvas.width = pixelCrop.width
  croppedCanvas.height = pixelCrop.height

  // Draw the cropped image onto the new canvas
  croppedCtx.drawImage(
    canvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  )

  // As a blob (WebP — matches the compressImage target format; avoids double-encode)
  return new Promise((resolve, reject) => {
    croppedCanvas.toBlob((blob) => {
      if (!blob || blob.size === 0) {
        reject(new Error('The browser could not create the cropped image. Please try another image.'))
        return
      }
      resolve(blob)
    }, 'image/webp', 0.92)
  })
}
