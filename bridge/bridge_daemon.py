# -*- coding: utf-8 -*-
# Warm daemon: keeps one --noUI CODESYS process alive and executes tasks from
# the queue directory in-process. Protocol:
#   submit : write  bridge/queue/<id>.json        {"op": ..., "args": {...}}
#   result : daemon writes bridge/queue/<id>.result.json, then deletes the task
#   ping   : daemon refreshes bridge/daemon_ping.json every loop
#   stop   : submit op "stop" (or create bridge/daemon_stop.flag)
# Projects stay open between tasks (args.keep_open defaults to true) and are
# saved after every task; after IDLE_CLOSE_S of no tasks all projects are
# closed (file locks released) while the daemon itself keeps running.
# NOTE: CODESYS ScriptEngine is Python 2 compatible -- avoid py3-only APIs.
import json
import os
import time
import traceback

BRIDGE_DIR = os.path.dirname(os.path.abspath(__file__))
QUEUE_DIR = os.path.join(BRIDGE_DIR, "queue")
PING_FILE = os.path.join(BRIDGE_DIR, "daemon_ping.json")
STOP_FILE = os.path.join(BRIDGE_DIR, "daemon_stop.flag")
BOOT_LOG = os.path.join(BRIDGE_DIR, "daemon_boot.log")

LOOP_S = 0.25
IDLE_CLOSE_S = float(os.environ.get("CB_IDLE_CLOSE_S", "900"))
STARTED = time.time()


def log_boot(msg):
    try:
        with open(BOOT_LOG, "a") as f:
            f.write("%.2f %s\n" % (time.time(), msg))
    except Exception:
        pass


try:
    os.makedirs(QUEUE_DIR)
except OSError:
    pass


def json_safe(o):
    """Recursively normalize strings so the embedded json encoder never sees
    a narrow byte string it cannot handle.

    ScriptEngine quirks (verified by probes 2026-10-27):
      * there is NO 'unicode' builtin; narrow and wide strings both report
        type name 'str' (only repr distinguishes them: u'...' vs '...');
      * the encoder decodes every narrow str as utf-8 and dies with
        "UnicodeDecodeError: 'unknown' codec" on legacy cp1251 bytes;
      * any .decode() returns a wide string, which serializes fine.
    So: attempt utf-8 then cp1251 on EVERY string; on success return the
    decoded (wide) value, otherwise pass through. Wide strings either decode
    idempotently or raise and fall through unchanged."""
    if isinstance(o, dict):
        return dict((json_safe(k), json_safe(v)) for k, v in o.items())
    if isinstance(o, (list, tuple)):
        return [json_safe(x) for x in o]
    if isinstance(o, str):
        # Whatever the flavor (narrow cp1251/utf-8 bytes, or wide), reduce it
        # to a NARROW utf-8 byte string: the encoder's s.decode('utf-8') then
        # always succeeds (probe-verified). Wide strings whose .decode raises
        # just get re-encoded to utf-8 via the last-resort branch.
        wide = None
        for enc in ("utf-8", "cp1251"):
            try:
                wide = o.decode(enc)
                break
            except Exception:
                pass
        if wide is None:
            try:
                wide = o.decode("utf-8", "replace")
            except Exception:
                wide = o
        try:
            return wide.encode("utf-8")
        except Exception:
            return wide
    return o


def nuclear_safe(o):
    """Last-resort sanitizer: only JSON-native types survive as-is; strings
    become their repr (guaranteed ASCII, never crashes the encoder); any
    other object becomes repr as well. Content may be mangled - this tier
    only exists so a result file is always written."""
    try:
        _long = long
    except NameError:
        _long = int
    if isinstance(o, dict):
        return dict((nuclear_safe(k), nuclear_safe(v)) for k, v in o.items())
    if isinstance(o, (list, tuple)):
        return [nuclear_safe(x) for x in o]
    if o is None or isinstance(o, (bool, int, _long, float)):
        return o
    try:
        return repr(o)
    except Exception:
        return "<unserializable>"

log_boot("boot")

# Suppress bridge.py's own main() and load its definitions into a namespace
# that inherits the ScriptEngine globals (projects, system, PouType, ...).
os.environ["CB_DAEMON"] = "1"
ns = dict(globals())
try:
    with open(os.path.join(BRIDGE_DIR, "bridge.py"), "r") as f:
        ns["__file__"] = os.path.join(BRIDGE_DIR, "bridge.py")
        ns["__name__"] = "bridge"
        exec(compile(f.read(), "bridge.py", "exec"), ns)
except Exception:
    log_boot("bridge load failed:\n" + traceback.format_exc())
    raise
run_task = ns["run_task"]
projects = ns["projects"]
log_boot("bridge loaded")

state = {"proj": None}
tasks_done = 0
last_task_ts = time.time()

# Warm-up: pre-open frequently used projects so the first real task is hot.
# Projects come from CB_WARM_PROJECTS (";" separated) or bridge/warm_projects.txt
# (one path per line); env wins when both are set.
_warm = os.environ.get("CB_WARM_PROJECTS", "")
if not _warm.strip():
    try:
        with open(os.path.join(BRIDGE_DIR, "warm_projects.txt"), "r") as f:
            _warm = ";".join(line.strip() for line in f if line.strip() and not line.strip().startswith("#"))
    except Exception:
        _warm = ""
if _warm.strip():
    for p in [x.strip() for x in _warm.split(";") if x.strip()]:
        # A leading '*' marks the project's warm-up open as PRIMARY.
        # SP21 finding: textual_declaration/implementations are WRITABLE only
        # in the primary project - with no primary, every set_code NREs.
        prim = p.startswith("*")
        if prim:
            p = p[1:].strip()
        r = {"ok": False, "error": "not attempted"}
        for attempt in (1, 2, 3):
            try:
                r = run_task({"op": "open_project",
                              "args": {"path": p, "keep_open": True, "no_save": True,
                                       "primary": False if not prim else None}},
                             state)
            except Exception as e:
                r = {"ok": False, "error": str(e)}
            if r.get("ok"):
                break
            if attempt < 3:
                time.sleep(5)  # residual file lock from a previous instance?
        log_boot("warmed " + p + " ok=" + str(r.get("ok")) +
                 ("" if r.get("ok") else " err=" + str(r.get("error"))[:200]))


def open_project_paths():
    out = []
    try:
        for p in list(projects.all):
            try:
                out.append(str(p.path))
            except Exception:
                pass
    except Exception:
        pass
    return out


def close_all_projects():
    closed = []
    try:
        for p in list(projects.all):
            try:
                try:
                    if bool(getattr(p, "dirty", False)):
                        p.save()
                except Exception:
                    pass
                path = str(p.path)
                p.close()
                closed.append(path)
            except Exception:
                pass
    except Exception:
        pass
    return closed


def write_ping(extra=None):
    info = {
        "ts": time.time(),
        "uptime_s": round(time.time() - STARTED, 1),
        "pid": os.getpid(),
        "tasks_done": tasks_done,
        "open_projects": open_project_paths(),
    }
    if extra:
        info.update(extra)
    # plain write (no os.replace: ScriptEngine python may lack it)
    with open(PING_FILE, "w") as f:
        json.dump(json_safe(info), f)


write_ping({"status": "starting"})
log_boot("loop start")

current_task_path = None

while True:
    try:
        if os.path.exists(STOP_FILE):
            os.remove(STOP_FILE)
            closed = close_all_projects()
            write_ping({"status": "stopped", "closed": closed})
            break

        task_files = sorted(
            f for f in os.listdir(QUEUE_DIR)
            if f.endswith(".json") and not f.endswith(".result.json")
        )

        if not task_files:
            if open_project_paths() and time.time() - last_task_ts > IDLE_CLOSE_S:
                closed = close_all_projects()
                write_ping({"status": "idle_closed", "closed": closed})
            write_ping()
            time.sleep(LOOP_S)
            continue

        for name in task_files:
            path = os.path.join(QUEUE_DIR, name)
            current_task_path = path
            try:
                with open(path, "r") as f:
                    task = json.load(f)
            except Exception:
                time.sleep(LOOP_S)
                continue
            op = task.get("op")
            if op == "stop":
                os.remove(path)
                closed = close_all_projects()
                write_ping({"status": "stopped", "closed": closed})
                raise SystemExit(0)
            args = task.setdefault("args", {})
            # warm mode: keep the project open in this session unless the
            # caller explicitly says otherwise
            args.setdefault("keep_open", True)
            t0 = time.time()
            result = run_task(task, state)
            result["elapsed_s"] = round(time.time() - t0, 3)
            tasks_done += 1
            last_task_ts = time.time()
            res_path = path[:-5] + ".result.json"
            try:
                with open(res_path, "w") as f:
                    json.dump(json_safe(result), f)
            except Exception:
                # the encoder still choked: fall back to a scrubbed payload
                # rather than spinning on the same task forever
                result["_nuclear_fallback"] = True
                with open(res_path, "w") as f:
                    json.dump(nuclear_safe(result), f)
            try:
                os.remove(path)
            except Exception:
                pass
            write_ping({"status": "ok" if result["ok"] else "error"})
            current_task_path = None
    except SystemExit:
        break
    except Exception:
        # park the poisoned task so one bad task cannot spin the loop forever
        if current_task_path and os.path.exists(current_task_path):
            try:
                os.rename(current_task_path,
                          current_task_path + ".poisoned")
            except Exception:
                pass
        current_task_path = None
        # never die silently: record the crash in ping and keep serving
        try:
            write_ping({"status": "loop_error",
                        "error": traceback.format_exc()})
        except Exception:
            pass
        time.sleep(LOOP_S)
