# Offline security checks only: no CODESYS instance or PLC is started.
import os
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
BRIDGE = os.path.join(os.path.dirname(HERE), "bridge.py")
os.environ["CB_DAEMON"] = "1"

namespace = {"__name__": "bridge", "__file__": BRIDGE}
with open(BRIDGE, "r") as source:
    exec(compile(source.read(), BRIDGE, "exec"), namespace)

with tempfile.TemporaryDirectory(prefix="codesys-bridge-security-") as work:
    namespace["BRIDGE_DIR"] = work
    result = namespace["run_task"]({"op": "not-a-real-operation", "args": {}})
    assert not result["ok"]
    assert "Traceback" not in result["error"]
    assert "bridge-errors.log" in result["error"]

    traversal = namespace["op_snapshot_restore"]({
        "confirm": True,
        "snapshot": "../outside",
        "project": os.path.join(work, "target.project")
    })
    assert traversal["error"] == "invalid snapshot name"

print("Python bridge security checks PASS")
