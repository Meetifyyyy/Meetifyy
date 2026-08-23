"""
Builds the default image assets the backend publishes to storage.

These start from the artwork already bundled in the frontend rather than
inventing new patterns: `default_cover.webp` (a blue blob maze) and
`default_community_cover.webp` (a marbled multi-colour swirl) are already
distinct designs in the product's own visual language, and replacing good
existing art with something programmatic would have been a regression
dressed up as a feature. What was missing was not the designs — it was that
they lived only as bundled front-end fallbacks and were never stored on the
records they described.

So this converts them to WebP at consistent sizes for upload, and derives the
one asset that genuinely did not exist: a community default avatar. That is
cut from the community cover's own pattern, so a community's default icon
and default cover visibly belong together, while the profile default avatar
stays the neutral person mark it has always been.

Run from backend/:  python3 assets/defaults/generate.py
"""
from PIL import Image
import os

SRC = "../frontend/src/assets/images"
OUT = os.path.join(os.path.dirname(__file__))

COVER = (1600, 400)
AVATAR = (512, 512)


def cover_from(src_name, out_name):
    """Fit the source to the cover aspect, cropping the overflow centrally."""
    im = Image.open(os.path.join(SRC, src_name)).convert("RGB")
    target_ratio = COVER[0] / COVER[1]
    w, h = im.size
    if w / h > target_ratio:
        new_w = int(h * target_ratio)
        im = im.crop(((w - new_w) // 2, 0, (w - new_w) // 2 + new_w, h))
    else:
        new_h = int(w / target_ratio)
        im = im.crop((0, (h - new_h) // 2, w, (h - new_h) // 2 + new_h))
    im = im.resize(COVER, Image.LANCZOS)
    im.save(os.path.join(OUT, out_name), "WEBP", quality=86, method=6)
    return im


def square_from(src_name, out_name):
    im = Image.open(os.path.join(SRC, src_name)).convert("RGB")
    w, h = im.size
    side = min(w, h)
    im = im.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))
    im = im.resize(AVATAR, Image.LANCZOS)
    im.save(os.path.join(OUT, out_name), "WEBP", quality=88, method=6)
    return im


def community_avatar_from_cover(cover_img, out_name):
    """
    A square tile lifted from the community cover's pattern.

    Taken from a third of the way in rather than dead centre: the middle of
    that particular artwork is its busiest region, and at 40px in a member
    list it turned to mush. This crop keeps a couple of readable shapes.
    """
    w, h = cover_img.size
    side = h
    left = int(w * 0.30)
    tile = cover_img.crop((left, 0, left + side, side)).resize(AVATAR, Image.LANCZOS)
    tile.save(os.path.join(OUT, out_name), "WEBP", quality=88, method=6)
    return tile


if __name__ == "__main__":
    profile_cover = cover_from("default_cover.webp", "profile-cover.webp")
    community_cover = cover_from("default_community_cover.webp", "community-cover.webp")
    square_from("default_avatar.webp", "profile-avatar.webp")
    community_avatar_from_cover(community_cover, "community-avatar.webp")

    for f in ("profile-cover.webp", "community-cover.webp", "profile-avatar.webp", "community-avatar.webp"):
        p = os.path.join(OUT, f)
        print(f"wrote {f}  {Image.open(p).size}  {os.path.getsize(p) // 1024}KB")
