import math

def arc_path(cx, cy, r, start_angle, end_angle):
    start_rad = math.radians(start_angle)
    end_rad = math.radians(end_angle)
    
    x1 = cx + r * math.cos(start_rad)
    y1 = cy + r * math.sin(start_rad)
    x2 = cx + r * math.cos(end_rad)
    y2 = cy + r * math.sin(end_rad)
    
    diff = (end_angle - start_angle) % 360
    large_arc = 1 if diff > 180 else 0
    
    return f"M {x1:.1f},{y1:.1f} A {r},{r} 0 {large_arc} 1 {x2:.1f},{y2:.1f}"

print("Original Blue Arc (135 to 315):", arc_path(256, 256, 172, 135, 315))
print("New Blue Arc (135 to 237):", arc_path(256, 256, 172, 135, 237))
print("New White Arc (247 to 315):", arc_path(256, 256, 172, 247, 315))
