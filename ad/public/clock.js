// A virtual clock for frame-exact capture (only with ?capture in the URL). setTimeout / setInterval /
// requestAnimationFrame / Date / performance.now all read ONE counter that only window.__adv(ms) moves,
// and CSS animations + transitions are paused and scrubbed to it. capture.mjs steps a frame, waits two
// REAL frames for the compositor, and takes the picture — so the video has no dropped frames however
// slow a frame was to draw.
;(function () {
  if (!/[?&]capture/.test(location.search)) return
  var BASE = new Date(2026, 8, 19, 10, 41, 50).getTime()
  var now = 0
  var seq = 0
  var timers = new Map() // id → { at, fn, every }
  var rafs = new Map()
  var real = { raf: window.requestAnimationFrame.bind(window), Date: Date }

  window.setTimeout = function (fn, ms) {
    var args = Array.prototype.slice.call(arguments, 2)
    var id = ++seq
    timers.set(id, { at: now + Math.max(0, +ms || 0), fn: function () { typeof fn === 'function' && fn.apply(null, args) }, every: 0 })
    return id
  }
  window.setInterval = function (fn, ms) {
    var args = Array.prototype.slice.call(arguments, 2)
    var id = ++seq
    var every = Math.max(1, +ms || 0)
    timers.set(id, { at: now + every, fn: function () { typeof fn === 'function' && fn.apply(null, args) }, every: every })
    return id
  }
  window.clearTimeout = window.clearInterval = function (id) { timers.delete(id) }
  window.requestAnimationFrame = function (cb) { var id = ++seq; rafs.set(id, cb); return id }
  window.cancelAnimationFrame = function (id) { rafs.delete(id) }
  performance.now = function () { return now }

  function VDate() {
    var a = arguments
    if (!(this instanceof VDate)) return new real.Date(BASE + now).toString()
    if (a.length === 0) return new real.Date(BASE + now)
    return new (Function.prototype.bind.apply(real.Date, [null].concat(Array.prototype.slice.call(a))))()
  }
  VDate.prototype = real.Date.prototype
  VDate.now = function () { return BASE + now }
  VDate.parse = real.Date.parse
  VDate.UTC = real.Date.UTC
  window.Date = VDate

  function runTimers(until) {
    for (var guard = 0; guard < 10000; guard++) {
      var next = null, nid = 0
      timers.forEach(function (t, id) { if (t.at <= until && (!next || t.at < next.at)) { next = t; nid = id } })
      if (!next) return
      now = Math.max(now, next.at)
      if (next.every) next.at += next.every
      else timers.delete(nid)
      try { next.fn() } catch (e) { console.error(e) }
    }
  }

  var born = new WeakMap()
  function scrub() {
    var list = document.getAnimations()
    for (var i = 0; i < list.length; i++) {
      var a = list[i]
      if (!born.has(a)) born.set(a, now - (Number(a.currentTime) || 0))
      var t = now - born.get(a)
      try {
        var end = a.effect ? a.effect.getComputedTiming().endTime : Infinity
        if (isFinite(end) && t >= end) a.finish()
        else { a.pause(); a.currentTime = t }
      } catch (e) { /* an animation that went away mid-loop */ }
    }
  }

  /** Move the clock on by `ms` (one video frame), run what fell due, scrub the animations, wait for paint. */
  window.__adv = function (ms) {
    var until = now + ms
    runTimers(until)
    now = until
    var cbs = Array.from(rafs.values())
    rafs.clear()
    for (var i = 0; i < cbs.length; i++) { try { cbs[i](now) } catch (e) { console.error(e) } }
    scrub()
    return new Promise(function (res) { real.raf(function () { scrub(); real.raf(function () { res(now) }) }) })
  }
  window.__virtual = true
})()
