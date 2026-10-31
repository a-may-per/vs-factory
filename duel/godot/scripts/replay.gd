extends Node2D
## Godot visual layer for the TS simulation JSONL.
## Synchronized with the upgraded Esports Broadcast HUD, easing ghost HP bars,
## floating damage/heal popups, lifesteal orbs, and bottom combat telemetry.

const ARENA := Rect2(48, 350, 984, 1200)
const FPS := 30.0
const RADIUS := 52.0
const COLORS := {"A": Color("#ff3358"), "B": Color("#1ca8ff")}
const COLORS2 := {"A": Color("#9e1432"), "B": Color("#0e569e")}

var events: Array = []
var cursor := 0
var replay_t := 0.0
var fighters := {}
var effects: Array = []
var popups: Array = []
var combat_logs: Array = []
var total_clashes := 0
var shake_t := 0.0
var shake_amp := 0.0
var paused := false

@export var pumpkin_sheet: Texture2D
@export var slime_sheet: Texture2D
const CELL := 48
const SPRITE_SCALE := 2.9
const FRAME_RATE := 12.0

func _ready() -> void:
    _load_events()
    queue_redraw()

func _load_events() -> void:
    var path := "user://events42.jsonl"
    if FileAccess.file_exists("res://events.jsonl"):
        path = "res://events.jsonl"
    if not FileAccess.file_exists(path):
        return
    var file := FileAccess.open(path, FileAccess.READ)
    while not file.eof_reached():
        var line := file.get_line().strip_edges()
        if line.is_empty(): continue
        var parsed = JSON.parse_string(line)
        if parsed is Dictionary: events.append(parsed)
    events.sort_custom(func(a, b): return float(a.get("t", 0)) < float(b.get("t", 0)))

func _process(delta: float) -> void:
    if paused: return
    replay_t += delta
    while cursor < events.size() and float(events[cursor].get("t", 0)) <= replay_t:
        _apply_event(events[cursor])
        cursor += 1
    for id in fighters:
        var f: Dictionary = fighters[id]
        f.action_t += delta
        f.skill_cd = max(0.0, float(f.skill_cd) - delta)
        f.ghost_hp = lerp(float(f.ghost_hp), float(f.hp), min(1.0, delta * 6.5))
        f.vis_x = lerp(float(f.vis_x), float(f.x), min(1.0, delta * 14.0))
        f.vis_y = lerp(float(f.vis_y), float(f.y), min(1.0, delta * 14.0))
        if f.action != "walk" and f.action_t > 0.45 and f.alive:
            f.action = "walk"
    shake_t = max(0.0, shake_t - delta)
    for fx in effects:
        fx.age += delta
    effects = effects.filter(func(fx): return fx.age < fx.life)
    for p in popups:
        p.age += delta
    popups = popups.filter(func(p): return p.age < p.life)
    queue_redraw()

func _apply_event(event: Dictionary) -> void:
    var kind := str(event.get("type", ""))
    var id := str(event.get("id", ""))
    if kind == "spawn":
        var max_hp := float(event.get("maxHp", 1000))
        fighters[id] = {
            "x": float(event.get("x", 0)), "y": float(event.get("y", 0)),
            "vis_x": float(event.get("x", 0)), "vis_y": float(event.get("y", 0)),
            "hp": max_hp, "ghost_hp": max_hp, "max_hp": max_hp,
            "name": str(event.get("name", id)),
            "title": str(event.get("title", "")),
            "passive": str(event.get("passive", "")),
            "active_name": str(event.get("activeName", "")),
            "alive": true, "action": "idle", "action_t": 0.0, "flip": id == "B",
            "rage": 0, "dmg_dealt": 0, "healed": 0, "casts": 0,
            "skill_cd": 0.0, "max_cd": 0.44,
            "weapon_angle": 0.0,
            "reach": float(event.get("reach", 175.0)),
            "blade_count": int(event.get("bladeCount", 1)),
            "body_scale": float(event.get("bodyScale", 1.0)),
            "stat_label": str(event.get("statLabel", "")),
        }
    elif kind == "move" and fighters.has(id):
        fighters[id].x = float(event.get("x", fighters[id].x))
        fighters[id].y = float(event.get("y", fighters[id].y))
        fighters[id].flip = int(event.get("facing", 1)) < 0
        fighters[id].weapon_angle = float(event.get("weaponAngle", fighters[id].weapon_angle))
        fighters[id].reach = float(event.get("reach", fighters[id].reach))
        fighters[id].blade_count = int(event.get("bladeCount", fighters[id].blade_count))
        fighters[id].body_scale = float(event.get("bodyScale", fighters[id].body_scale))
        if fighters[id].action != "skill" and fighters[id].action != "hit" and fighters[id].alive:
            fighters[id].action = "walk"
    elif kind == "parry":
        total_clashes += 1
        shake_t = 0.16
        shake_amp = 9.0
        var combo := int(event.get("combo", 1))
        effects.append({"kind": "parry", "x": float(event.get("x", 0)), "y": float(event.get("y", 0)), "age": 0.0, "life": 0.36})
        popups.append({"text": "连弹 ×%d" % combo if combo >= 2 else "弹刀!", "x": float(event.get("x", 0)), "y": float(event.get("y", 0)) - 48.0, "color": Color("#ffe85c"), "age": 0.0, "life": 0.55})
    elif kind == "damage" and fighters.has(id):
        var val := int(event.get("value", 0))
        var from_id := str(event.get("from", ""))
        fighters[id].hp = float(event.get("hp", fighters[id].hp))
        fighters[id].action = "hit"
        fighters[id].action_t = 0.0
        if fighters.has(from_id):
            fighters[from_id].dmg_dealt += val
        effects.append({"kind": "hit", "x": float(event.get("x", 0)), "y": float(event.get("y", 0)), "age": 0.0, "life": 0.28})
        popups.append({"text": "-%d" % val, "x": float(event.get("x", 0)), "y": float(event.get("y", 0)) - 60.0, "color": Color("#ff5c5c"), "age": 0.0, "life": 0.85})
    elif kind == "heal" and fighters.has(id):
        var val := int(event.get("value", 0))
        fighters[id].hp = float(event.get("hp", fighters[id].hp))
        fighters[id].healed += val
        popups.append({"text": "+%d HP" % val, "x": float(event.get("x", 0)), "y": float(event.get("y", 0)) - 42.0, "color": Color("#4ef598"), "age": 0.0, "life": 0.85})
    elif kind == "buff" and fighters.has(id):
        fighters[id].rage = int(event.get("stacks", 0))
        fighters[id].reach = float(event.get("reach", fighters[id].reach))
        fighters[id].blade_count = int(event.get("bladeCount", fighters[id].blade_count))
        fighters[id].body_scale = float(event.get("bodyScale", fighters[id].body_scale))
        fighters[id].stat_label = str(event.get("statLabel", fighters[id].stat_label))
    elif kind == "skill" and fighters.has(id):
        fighters[id].action = "skill"
        fighters[id].action_t = 0.0
        fighters[id].casts += 1
        fighters[id].skill_cd = fighters[id].max_cd
        total_clashes += 1
        shake_t = 0.24
        shake_amp = 10.0
        effects.append({"kind": "skill", "id": id, "x": float(event.get("x", 0)), "y": float(event.get("y", 0)), "age": 0.0, "life": 0.42})
        combat_logs.append("[%04.1fs] %s 释放【%s】" % [replay_t, fighters[id].name, str(event.get("name", "技能"))])
        if combat_logs.size() > 3: combat_logs.pop_front()
    elif kind == "skillEffect":
        effects.append({"kind": str(event.get("kind", "bounce")), "id": id, "x": float(event.get("x", 0)), "y": float(event.get("y", 0)), "age": 0.0, "life": 0.45})
    elif kind == "death" and fighters.has(id):
        fighters[id].alive = false
        fighters[id].action = "death"
        fighters[id].action_t = 0.0
        shake_t = 0.38
        shake_amp = 16.0

func _arena_pos(wx: float, wy: float) -> Vector2:
    var sx := sin(replay_t * 85.0) * shake_amp * (shake_t / 0.3) if shake_t > 0.0 else 0.0
    var sy := cos(replay_t * 73.0) * shake_amp * 0.6 * (shake_t / 0.3) if shake_t > 0.0 else 0.0
    return Vector2(ARENA.position.x + wx * ARENA.size.x / 984.0 + sx, ARENA.position.y + wy * ARENA.size.y / 1200.0 + sy)

func _draw() -> void:
    draw_rect(Rect2(0, 0, 1080, 1920), Color("#080712"))
    draw_rect(ARENA.grow(8), Color("#141226"), true)
    draw_rect(ARENA, Color("#161428"), true)
    _draw_grid()
    for id in ["A", "B"]:
        if fighters.has(id): _draw_fighter(id, fighters[id])
    for fx in effects: _draw_effect(fx)
    for p in popups: _draw_popup(p)
    _draw_hud()

func _draw_grid() -> void:
    var cols := 12
    var rows := 8
    var cw := ARENA.size.x / cols
    var ch := ARENA.size.y / rows
    for y in range(rows):
        for x in range(cols):
            if (x + y) % 2 == 0:
                draw_rect(Rect2(ARENA.position + Vector2(x * cw, y * ch), Vector2(cw, ch)), Color("#252340"), true)
    draw_arc(ARENA.position + ARENA.size * 0.5, 150.0, 0, TAU, 48, Color(0.45, 0.38, 0.72, 0.32), 3.0)
    draw_rect(ARENA, Color("#7668be"), false, 4.0)

func _draw_fighter(id: String, f: Dictionary) -> void:
    var p := _arena_pos(float(f.vis_x), float(f.vis_y))
    var sheet: Texture2D = pumpkin_sheet if id == "A" else slime_sheet
    if sheet == null:
        return
    var row: int = int({"idle": 0, "walk": 1, "skill": 5, "hit": 3, "death": 4}.get(f.action, 0))
    var frame_count: int = 6 if row == 5 else 4
    var frame: int = int(f.action_t * FRAME_RATE) % frame_count
    var source: Rect2 = Rect2(frame * CELL, row * CELL, CELL, CELL)
    var visual_half := CELL * SPRITE_SCALE / 2.0
    p.x = clamp(p.x, ARENA.position.x + visual_half, ARENA.end.x - visual_half)
    p.y = clamp(p.y, ARENA.position.y + visual_half, ARENA.end.y - visual_half)

    var bscale := float(f.get("body_scale", 1.0))
    var reach := float(f.get("reach", 170.0))
    var blades := int(f.get("blade_count", 1))
    var wang := float(f.get("weapon_angle", 0.0))
    for k in range(blades):
        var ang := wang + TAU * float(k) / float(max(1, blades))
        var dir := Vector2(cos(ang), sin(ang))
        draw_line(p + dir * (30.0 * bscale), p + dir * reach, COLORS[id], 12.0, true)
        draw_line(p + dir * (34.0 * bscale), p + dir * (reach * 0.94), Color.WHITE, 4.0, true)

    draw_circle(p, 52.0 * bscale, Color(0, 0, 0, 0.55))
    draw_arc(p, 52.0 * bscale, 0, TAU, 32, COLORS[id], 4.5)

    var flip_scale := -SPRITE_SCALE if bool(f.flip) else SPRITE_SCALE
    draw_set_transform(p, 0.0, Vector2(flip_scale, SPRITE_SCALE))
    var local_dest := Rect2(-CELL / 2.0, -CELL, CELL, CELL)
    draw_texture_rect_region(sheet, local_dest, source)
    draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

func _draw_effect(fx: Dictionary) -> void:
    var p := _arena_pos(float(fx.x), float(fx.y))
    var k: float = float(fx.age) / float(fx.life)
    if fx.kind == "skill":
        draw_arc(p, 26.0 + k * 90.0, 0, TAU, 32, Color(1.0, 0.85, 0.32, 1.0 - k), 6.0)
    elif fx.kind == "rage":
        draw_arc(p, 30.0 + k * 42.0, 0, TAU, 24, Color(1.0, 0.45, 0.12, 0.85 - k), 4.0)
    elif fx.kind == "lifesteal":
        draw_circle(p, 12.0 + k * 10.0, Color(0.98, 0.22, 0.42, 0.85 - k))
    elif fx.kind == "parry":
        draw_arc(p, 24.0 + k * 95.0, 0, TAU, 28, Color(1.0, 0.92, 0.45, 1.0 - k), 5.0)
    elif fx.kind == "hit":
        draw_arc(p, 16.0 + k * 40.0, 0, TAU, 20, Color(1, 1, 0.85, 0.85 - k), 4.0)

func _draw_popup(p: Dictionary) -> void:
    var pos := _arena_pos(float(p.x), float(p.y) - float(p.age) * 65.0)
    var alpha := clamp(1.0 - float(p.age) / float(p.life), 0.0, 1.0)
    var c: Color = p.color
    c.a = alpha
    draw_string(ThemeDB.fallback_font, pos, str(p.text), HORIZONTAL_ALIGNMENT_CENTER, 160, 28, c)

func _draw_hud() -> void:
    draw_rect(Rect2(24, 76, 1032, 236), Color("#16142a"), true)
    draw_rect(Rect2(24, 76, 1032, 236), Color("#584e94"), false, 2.0)
    draw_string(ThemeDB.fallback_font, Vector2(450, 155), "%02ds" % int(replay_t), HORIZONTAL_ALIGNMENT_CENTER, 180, 42, Color("#ffd86e"))
    draw_string(ThemeDB.fallback_font, Vector2(450, 255), "交锋 %d 次" % total_clashes, HORIZONTAL_ALIGNMENT_CENTER, 180, 22, Color("#d0c8f8"))
    for id in ["A", "B"]:
        if not fighters.has(id): continue
        var f: Dictionary = fighters[id]
        var is_a := id == "A"
        var x := 42.0 if is_a else 618.0
        var bar_w := 420.0
        draw_string(ThemeDB.fallback_font, Vector2(x, 126), "%s 【%s】" % [f.name, f.title], HORIZONTAL_ALIGNMENT_LEFT if is_a else HORIZONTAL_ALIGNMENT_RIGHT, bar_w, 28, COLORS[id])
        draw_rect(Rect2(x, 190, bar_w, 34), Color("#0c0a16"), true)
        var ghost_w := (bar_w - 6.0) * clamp(float(f.ghost_hp) / max(1.0, float(f.max_hp)), 0.0, 1.0)
        var hp_w := (bar_w - 6.0) * clamp(float(f.hp) / max(1.0, float(f.max_hp)), 0.0, 1.0)
        var gx := x + 3.0 if is_a else x + 3.0 + (bar_w - 6.0 - ghost_w)
        var hx := x + 3.0 if is_a else x + 3.0 + (bar_w - 6.0 - hp_w)
        draw_rect(Rect2(gx, 193, ghost_w, 28), Color("#ffefc2"), true)
        draw_rect(Rect2(hx, 193, hp_w, 28), COLORS[id], true)
        draw_string(ThemeDB.fallback_font, Vector2(x + 12, 214), "%d / %d HP" % [int(ceil(float(f.hp))), int(f.max_hp)], HORIZONTAL_ALIGNMENT_LEFT if is_a else HORIZONTAL_ALIGNMENT_RIGHT, bar_w - 24, 20, Color.WHITE)

func _draw_telemetry() -> void:
    draw_rect(Rect2(36, 1256, 1008, 520), Color("#141226"), true)
    draw_rect(Rect2(36, 1256, 1008, 520), Color("#4e4686"), false, 2.0)
    for i in range(combat_logs.size()):
        draw_string(ThemeDB.fallback_font, Vector2(64, 1600 + i * 44), str(combat_logs[i]), HORIZONTAL_ALIGNMENT_LEFT, 940, 24, Color("#e8e4ff"))
