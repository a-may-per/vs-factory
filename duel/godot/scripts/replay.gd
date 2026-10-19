extends Node2D
## Godot visual layer for the TS simulation JSONL.
## The TS simulator remains authoritative: roaming, wall bounces, contact skills and outcomes
## arrive as events. This scene owns only sprites, particles, HUD and camera presentation.

const ARENA := Rect2(60, 620, 960, 540)
const FPS := 30.0
const RADIUS := 42.0
const COLORS := {"A": Color("#f08a24"), "B": Color("#ef4b35")}

var events: Array = []
var cursor := 0
var replay_t := 0.0
var fighters := {}
var effects: Array = []
var paused := false

@export var pumpkin_sheet: Texture2D
@export var slime_sheet: Texture2D
const CELL := 48
const SPRITE_SCALE := 1.75
const FRAME_RATE := 10.0

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
        fighters[id].action_t += delta
        if fighters[id].action != "walk" and fighters[id].action_t > 0.45 and fighters[id].alive:
            fighters[id].action = "idle"
    for fx in effects:
        fx.age += delta
    effects = effects.filter(func(fx): return fx.age < fx.life)
    queue_redraw()

func _apply_event(event: Dictionary) -> void:
    var kind := str(event.get("type", ""))
    var id := str(event.get("id", ""))
    if kind == "spawn":
        fighters[id] = {"x": float(event.get("x", 0)), "y": float(event.get("y", 0)), "hp": float(event.get("maxHp", 1)), "max_hp": float(event.get("maxHp", 1)), "alive": true, "action": "idle", "action_t": 0.0, "flip": false}
    elif kind == "move" and fighters.has(id):
        fighters[id].x = float(event.get("x", fighters[id].x))
        fighters[id].y = float(event.get("y", fighters[id].y))
        fighters[id].flip = int(event.get("facing", 1)) < 0
        fighters[id].action = "walk"
        fighters[id].action_t = 0.0
    elif kind == "damage" and fighters.has(id):
        fighters[id].hp = float(event.get("hp", fighters[id].hp))
        fighters[id].action = "hit"
        fighters[id].action_t = 0.0
        effects.append({"kind": "hit", "x": float(event.get("x", 0)), "y": float(event.get("y", 0)), "age": 0.0, "life": 0.22})
    elif kind == "skill" and fighters.has(id):
        fighters[id].action = "skill"
        fighters[id].action_t = 0.0
        effects.append({"kind": "skill", "id": id, "x": float(event.get("x", 0)), "y": float(event.get("y", 0)), "age": 0.0, "life": 0.35})
    elif kind == "skillEffect":
        effects.append({"kind": str(event.get("kind", "bounce")), "id": id, "x": float(event.get("x", 0)), "y": float(event.get("y", 0)), "age": 0.0, "life": 0.42})
    elif kind == "death" and fighters.has(id):
        fighters[id].alive = false
        fighters[id].action = "death"
        fighters[id].action_t = 0.0

func _arena_pos(f: Dictionary) -> Vector2:
    return Vector2(ARENA.position.x + float(f.x) * ARENA.size.x / 960.0, ARENA.position.y + float(f.y) * ARENA.size.y / 540.0)

func _draw() -> void:
    draw_rect(Rect2(0, 0, 1080, 1920), Color("#0d0b16"))
    draw_rect(ARENA, Color("#1d1b30"), true)
    _draw_grid()
    for id in ["A", "B"]:
        if fighters.has(id): _draw_fighter(id, fighters[id])
    for fx in effects: _draw_effect(fx)
    _draw_hud()

func _draw_grid() -> void:
    var cell := 54.0
    for y in range(10):
        for x in range(18):
            if (x + y) % 2 == 0:
                draw_rect(Rect2(ARENA.position + Vector2(x * cell, y * cell), Vector2(cell, cell)), Color("#252340"), true)
    draw_rect(ARENA, Color("#625698"), false, 5.0)

func _draw_fighter(id: String, f: Dictionary) -> void:
    var p := _arena_pos(f)
    var sheet: Texture2D = pumpkin_sheet if id == "A" else slime_sheet
    if sheet == null:
        return
    # 第 6 行才是角色专属技能；第 3 行保留为通用 cast。
    var row: int = int({"idle": 0, "walk": 1, "skill": 5, "hit": 3, "death": 4}.get(f.action, 0))
    var frame_count: int = 6 if row == 5 else 4
    var frame: int = int(f.action_t * FRAME_RATE) % frame_count
    var source: Rect2 = Rect2(frame * CELL, row * CELL, CELL, CELL)
    var visual_half := CELL * SPRITE_SCALE / 2.0
    p.x = clamp(p.x, ARENA.position.x + visual_half, ARENA.end.x - visual_half)
    p.y = clamp(p.y, ARENA.position.y + visual_half, ARENA.end.y - visual_half)

    # 以角色脚底中心为原点镜像。不能用负宽 Rect2：负宽会让 Godot 从错误锚点
    # 向外展开贴图，角色贴右墙并朝左时就会视觉穿墙。
    var flip_scale := -SPRITE_SCALE if bool(f.flip) else SPRITE_SCALE
    draw_set_transform(p, 0.0, Vector2(flip_scale, SPRITE_SCALE))
    var local_dest := Rect2(-CELL / 2.0, -CELL, CELL, CELL)
    draw_texture_rect_region(sheet, local_dest, source)
    draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

func _draw_effect(fx: Dictionary) -> void:
    var p := ARENA.position + Vector2(float(fx.x) * ARENA.size.x / 960.0, float(fx.y) * ARENA.size.y / 540.0)
    var k: float = float(fx.age) / float(fx.life)
    if fx.kind == "skill":
        draw_arc(p, 24.0 + k * 54.0, 0, TAU, 24, Color(1.0, 0.85, 0.32, 1.0 - k), 5.0)
    elif fx.kind == "rage":
        draw_arc(p, 30.0 + k * 24.0, 0, TAU, 20, Color(1.0, 0.35, 0.08, 0.75 - k), 4.0)
    elif fx.kind == "lifesteal":
        draw_circle(p, 9.0 + k * 8.0, Color(0.95, 0.12, 0.25, 0.8 - k))
    elif fx.kind == "hit":
        draw_arc(p, 14.0 + k * 30.0, 0, TAU, 16, Color(1, 1, 0.8, 0.8 - k), 4.0)

func _draw_hud() -> void:
    draw_string(ThemeDB.fallback_font, Vector2(450, 70), "%02d s" % int(replay_t), HORIZONTAL_ALIGNMENT_CENTER, 180, 32, Color("#ffd86e"))
    for id in ["A", "B"]:
        if not fighters.has(id): continue
        var f: Dictionary = fighters[id]
        var x := 44.0 if id == "A" else 636.0
        draw_string(ThemeDB.fallback_font, Vector2(x, 42), "南瓜骑士" if id == "A" else "火焰史莱姆", HORIZONTAL_ALIGNMENT_LEFT, 400, 32, COLORS[id])
        draw_rect(Rect2(x, 74, 400, 24), Color("#262238"), true)
        draw_rect(Rect2(x + 3, 77, 394 * clamp(float(f.hp) / max(1.0, float(f.max_hp)), 0.0, 1.0), 18), COLORS[id], true)
