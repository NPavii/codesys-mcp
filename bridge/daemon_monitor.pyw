# -*- coding: utf-8 -*-
# Companion window for the CODESYS warm bridge daemon.
# Started together with bridge_daemon.cmd; shows live status, which project
# the daemon is working with, queue activity and the tail of the daemon log.
# The daemon itself cannot draw (it runs head-less inside CODESYS.exe), so
# this little app only READS daemon_ping.json / daemon_boot.log / queue/.
# Closing the window never stops the daemon.
#
# Disable via environment variable CB_MONITOR=0 in bridge_daemon.cmd.
import json
import os
import time
import tkinter as tk
from tkinter import ttk

BRIDGE = os.path.dirname(os.path.abspath(__file__))
PING = os.path.join(BRIDGE, "daemon_ping.json")
BOOT_LOG = os.path.join(BRIDGE, "daemon_boot.log")
QUEUE = os.path.join(BRIDGE, "queue")
POLL_MS = 1000
LOG_LINES = 12

STATUS_STYLE = {
    "ok": ("#2e7d32", "● жив — горячо"),
    "loop_error": ("#c62828", "● ошибка цикла"),
    "stopped": ("#616161", "● остановлен"),
    "dead": ("#c62828", "● не отвечает"),
}


def read_ping():
    try:
        with open(PING, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def queue_info():
    pending, results = [], []
    try:
        for name in os.listdir(QUEUE):
            path = os.path.join(QUEUE, name)
            if name.endswith(".result.json"):
                results.append((os.path.getmtime(path), name))
            elif name.endswith(".json"):
                pending.append((os.path.getmtime(path), name))
    except Exception:
        pass
    return pending, results


def pending_projects(pending):
    """Best-effort: which project each queued task is working on."""
    projs = []
    for _, name in pending:
        try:
            with open(os.path.join(QUEUE, name), "r", encoding="utf-8") as f:
                task = json.load(f)
            p = (task.get("args") or {}).get("project") or task.get("op")
            projs.append("%s (%s)" % (os.path.basename(str(p)), task.get("op")))
        except Exception:
            projs.append(name)
    return projs


def tail_boot_log(n=LOG_LINES):
    try:
        with open(BOOT_LOG, "r", encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
        return lines[-n:]
    except Exception:
        return []


class Monitor(tk.Tk):
    def __init__(self):
        tk.Tk.__init__(self)
        self.title("CODESYS Bridge — монитор демона")
        self.geometry("640x560")
        self.minsize(520, 420)

        self._build()
        self._tick()

    def _build(self):
        top = ttk.Frame(self, padding=8)
        top.pack(fill="x")

        self.dot = tk.Label(top, text="●", font=("Segoe UI", 22))
        self.dot.pack(side="left")
        self.status_lbl = tk.Label(top, text="…", font=("Segoe UI", 12, "bold"))
        self.status_lbl.pack(side="left", padx=(6, 16))

        self.info = tk.Label(top, text="", font=("Consolas", 9), justify="left")
        self.info.pack(side="left")

        ttk.Separator(self).pack(fill="x")

        mid = ttk.Frame(self, padding=8)
        mid.pack(fill="both", expand=True)

        left = ttk.LabelFrame(mid, text=" Открытые проекты (в работе у демона) ", padding=6)
        left.pack(side="left", fill="both", expand=True, padx=(0, 4))
        self.projects = tk.Listbox(left, font=("Consolas", 9), activestyle="none",
                                   exportselection=False)
        self.projects.pack(fill="both", expand=True)

        right = ttk.LabelFrame(mid, text=" Очередь задач ", padding=6)
        right.pack(side="left", fill="both", expand=True, padx=(4, 0))
        self.queue_lbl = tk.Label(right, text="", font=("Consolas", 9), anchor="nw",
                                  justify="left")
        self.queue_lbl.pack(fill="x")
        self.queue_list = tk.Listbox(right, font=("Consolas", 9), activestyle="none",
                                     exportselection=False)
        self.queue_list.pack(fill="both", expand=True, pady=(4, 0))

        bottom = ttk.LabelFrame(self, text=" daemon_boot.log (хвост) ", padding=6)
        bottom.pack(fill="both", expand=True, padx=8, pady=(0, 8))
        self.log = tk.Text(bottom, height=10, font=("Consolas", 8), state="disabled",
                           wrap="none", bg="#101418", fg="#b8c4cc")
        self.log.pack(fill="both", expand=True)

        self.proto = tk.Label(self, text="", font=("Consolas", 8), fg="#666",
                              anchor="w", padx=8)
        self.proto.pack(fill="x", side="bottom")

    def _set_log(self, lines):
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.insert("end", "\n".join(lines))
        self.log.see("end")
        self.log.configure(state="disabled")

    def _tick(self):
        ping = read_ping()
        pending, results = queue_info()

        if ping is None:
            color, text = STATUS_STYLE["dead"]
            detail = "daemon_ping.json не найден или пуст\nдемон не запущен?"
        else:
            status = ping.get("status")
            if status in STATUS_STYLE:
                color, text = STATUS_STYLE[status]
            elif time.time() - ping.get("ts", 0) < 10:
                color, text = STATUS_STYLE["ok"]
            else:
                color, text = STATUS_STYLE["dead"]
            detail = ("pid %s   uptime %s   задач выполнено: %s"
                      % (ping.get("pid"), self._fmt_uptime(ping.get("uptime_s")),
                         ping.get("tasks_done")))
            err = (ping.get("error") or "").strip()
            if err:
                tail = err.splitlines()[-1]
                detail += "\nпоследняя ошибка: " + tail[:120]

        self.dot.configure(fg=color)
        self.status_lbl.configure(text=text, fg=color)
        self.info.configure(text=detail)

        # projects
        self.projects.delete(0, "end")
        if ping and ping.get("open_projects"):
            for p in ping["open_projects"]:
                self.projects.insert("end", p)
            self.projects.insert("end", "")
            self.projects.insert("end", "первый в списке = primary (пишется код)")
        else:
            self.projects.insert("end", "(нет открытых проектов)")

        # queue
        self.queue_lbl.configure(
            text="в очереди: %d   результатов на диске: %d"
                 % (len(pending), len(results)))
        self.queue_list.delete(0, "end")
        for item in pending_projects(pending):
            self.queue_list.insert("end", "⏳ " + item)
        if results:
            newest = max(results)[1]
            self.queue_list.insert("end", "последний результат: " + newest[:40])

        self._set_log(tail_boot_log())

        if ping and ping.get("status") == "stopped":
            self.proto.configure(text="демон остановлен — окно закроется автоматически")
            self.after(3000, self.destroy)
            return
        self.proto.configure(text="обновление каждую секунду · закрытие окна НЕ останавливает демон")
        self.after(POLL_MS, self._tick)

    @staticmethod
    def _fmt_uptime(s):
        try:
            s = int(s or 0)
        except Exception:
            return "?"
        h, rem = divmod(s, 3600)
        m, sec = divmod(rem, 60)
        return "%d:%02d:%02d" % (h, m, sec)


if __name__ == "__main__":
    app = Monitor()
    app.mainloop()
