// pcsx2-bridge: the deck's hands on PCSX2 (main/pcsx2.ts). PCSX2 is its own app; the deck mirrors its
// game window into a tile and plays it from there, so something must (1) find that window — its
// CGWindowID is what Electron's desktop capture calls `window:<id>:0` — and (2) put key presses into
// PCSX2 while the DECK is the frontmost app. CGEvent.postToPid delivers a key event to one process's
// event queue without bringing it forward. That needs Accessibility permission for the app that runs
// this (macOS asks once: System Settings › Privacy & Security › Accessibility).
//
// Line protocol on stdin, one JSON object per line on stdout:
//   trusted                       {"trusted":true|false}   (asks macOS to prompt when false)
//   windows <pid>                 {"windows":[{"id":…,"title":"…","w":…,"h":…,"onscreen":true}]}
//   down <keycode> <pid>          {"ok":true}             a key goes down in that process
//   up <keycode> <pid>            {"ok":true}
// With arguments instead of stdin it runs one command and exits (for testing by hand).

import ApplicationServices
import Foundation

func out(_ obj: Any) {
  if let data = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: data, encoding: .utf8) {
    print(s)
    fflush(stdout)
  }
}

func windows(_ pid: pid_t) -> [[String: Any]] {
  guard let list = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return [] }
  return list.compactMap { w in
    guard (w[kCGWindowOwnerPID as String] as? Int).map({ pid_t($0) }) == pid,
          let id = w[kCGWindowNumber as String] as? Int,
          let b = w[kCGWindowBounds as String] as? [String: Any],
          (w[kCGWindowLayer as String] as? Int) == 0 else { return nil }
    return [
      "id": id,
      "title": w[kCGWindowName as String] as? String ?? "",
      "w": b["Width"] as? Double ?? 0,
      "h": b["Height"] as? Double ?? 0,
      "onscreen": w[kCGWindowIsOnscreen as String] as? Bool ?? false
    ]
  }
}

func key(_ code: Int, _ down: Bool, _ pid: pid_t) -> Bool {
  guard let ev = CGEvent(keyboardEventSource: CGEventSource(stateID: .hidSystemState), virtualKey: CGKeyCode(code), keyDown: down) else { return false }
  ev.postToPid(pid)
  return true
}

func run(_ parts: [String]) {
  guard let cmd = parts.first else { return }
  switch cmd {
  case "trusted":
    let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    out(["trusted": AXIsProcessTrustedWithOptions(opts)])
  case "windows" where parts.count == 2:
    out(["windows": windows(pid_t(parts[1]) ?? 0)])
  case "down" where parts.count == 3, "up" where parts.count == 3:
    out(["ok": key(Int(parts[1]) ?? -1, cmd == "down", pid_t(parts[2]) ?? 0)])
  default:
    out(["error": "unknown command: \(parts.joined(separator: " "))"])
  }
}

let args = Array(CommandLine.arguments.dropFirst())
if !args.isEmpty {
  run(args)
} else {
  while let line = readLine() {
    run(line.split(separator: " ").map(String.init))
  }
}
