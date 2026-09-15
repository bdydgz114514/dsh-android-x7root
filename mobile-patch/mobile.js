/**
 * WebView 兼容层（Android 系统 WebView < 122 时的兜底）
 *
 * DSH 0.1.5 的浏览器端 bundle 使用了若干较新的 JS/Web 平台 API：
 *   - Iterator helpers（Chrome 122+）
 *   - Promise.withResolvers（Chrome 119+）
 *   - URL.parse（Chrome 126+）
 *   - Symbol.dispose / Symbol.asyncDispose（Chrome 134+）
 * 老 WebView（如 117）上会在「导入客户端插件」阶段直接抛错，
 * 表现为整页「Failed to load plugins … Iterator is not defined」。
 *
 * 本脚本作为普通 <script> 注入（在 defer 的 module 之前执行），
 * 只补齐缺失的 API，已存在则完全不动（现代 WebView 上为 no-op）。
 */
(function () {
  "use strict";
  try {
    var g = typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : this);

    /* ---------- Promise.withResolvers (Chrome 119+) ---------- */
    if (typeof Promise !== "undefined" && typeof Promise.withResolvers !== "function") {
      Object.defineProperty(Promise, "withResolvers", {
        configurable: true,
        writable: true,
        value: function () {
          var resolve, reject;
          var promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
          return { promise: promise, resolve: resolve, reject: reject };
        }
      });
    }

    /* ---------- Symbol.dispose / Symbol.asyncDispose (Chrome 134+) ---------- */
    if (typeof Symbol !== "undefined") {
      if (typeof Symbol.dispose !== "symbol") {
        Object.defineProperty(Symbol, "dispose", { configurable: true, writable: false, value: Symbol("Symbol.dispose") });
      }
      if (typeof Symbol.asyncDispose !== "symbol") {
        Object.defineProperty(Symbol, "asyncDispose", { configurable: true, writable: false, value: Symbol("Symbol.asyncDispose") });
      }
    }

    /* ---------- URL.parse (Chrome 126+) ---------- */
    if (typeof URL !== "undefined" && typeof URL.parse !== "function") {
      Object.defineProperty(URL, "parse", {
        configurable: true,
        writable: true,
        value: function (url, base) {
          try {
            return base === undefined ? new URL(url) : new URL(url, base);
          } catch (e) {
            return null;
          }
        }
      });
    }

    /* ---------- Iterator helpers (Chrome 122+) ---------- */
    (function () {
      var IteratorCtor = g.Iterator;
      if (typeof IteratorCtor !== "function") {
        IteratorCtor = function Iterator() { throw new TypeError("Iterator is not a constructor"); };
        Object.defineProperty(g, "Iterator", { value: IteratorCtor, writable: true, configurable: true });
      }
      var arrayIterProto = null;
      try { arrayIterProto = Object.getPrototypeOf(Object.getPrototypeOf([][Symbol.iterator]())); } catch (e) {}
      var genProto = null;
      try { genProto = Object.getPrototypeOf(Object.getPrototypeOf((function* () {})())); } catch (e) {}

      function toIterator(value) {
        if (value !== null && value !== undefined && typeof value.next === "function") return value;
        if (value !== null && value !== undefined && typeof value[Symbol.iterator] === "function") return value[Symbol.iterator]();
        throw new TypeError("value is not an iterator or iterable");
      }
      function wrap(next) {
        var o = { next: next };
        if (arrayIterProto) Object.setPrototypeOf(o, arrayIterProto);
        return o;
      }

      var methods = {
        map: function (fn) {
          var it = toIterator(this);
          return wrap(function () { var r = it.next(); return r.done ? r : { value: fn(r.value), done: false }; });
        },
        filter: function (fn) {
          var it = toIterator(this);
          return wrap(function () { for (;;) { var r = it.next(); if (r.done || fn(r.value)) return r; } });
        },
        take: function (n) {
          var it = toIterator(this);
          var left = Math.max(0, n);
          return wrap(function () { if (left <= 0) return { value: undefined, done: true }; left--; return it.next(); });
        },
        drop: function (n) {
          var it = toIterator(this);
          var left = Math.max(0, n);
          return wrap(function () {
            while (left > 0) { left--; var r = it.next(); if (r.done) return r; }
            return it.next();
          });
        },
        flatMap: function (fn) {
          var it = toIterator(this);
          var inner = null;
          return wrap(function () {
            for (;;) {
              if (inner) { var r = inner.next(); if (!r.done) return r; inner = null; }
              var o = it.next();
              if (o.done) return o;
              inner = toIterator(fn(o.value));
            }
          });
        },
        reduce: function (fn, initial) {
          var it = toIterator(this);
          var acc = initial;
          var started = arguments.length > 1;
          for (;;) {
            var r = it.next();
            if (r.done) {
              if (!started) throw new TypeError("reduce of empty iterator with no initial value");
              return acc;
            }
            if (!started) { acc = r.value; started = true; } else { acc = fn(acc, r.value); }
          }
        },
        toArray: function () {
          var it = toIterator(this);
          var out = [];
          for (;;) { var r = it.next(); if (r.done) return out; out.push(r.value); }
        },
        forEach: function (fn) {
          var it = toIterator(this);
          for (;;) { var r = it.next(); if (r.done) return; fn(r.value); }
        },
        some: function (fn) {
          var it = toIterator(this);
          for (;;) { var r = it.next(); if (r.done) return false; if (fn(r.value)) return true; }
        },
        every: function (fn) {
          var it = toIterator(this);
          for (;;) { var r = it.next(); if (r.done) return true; if (!fn(r.value)) return false; }
        },
        find: function (fn) {
          var it = toIterator(this);
          for (;;) {
            var r = it.next();
            if (r.done) return undefined;
            if (fn(r.value)) return r.value;
          }
        },
        join: function (separator) { return this.toArray().join(separator); }
      };

      var targets = [IteratorCtor.prototype, arrayIterProto, genProto];
      for (var i = 0; i < targets.length; i++) {
        var proto = targets[i];
        if (!proto) continue;
        for (var name in methods) {
          if (Object.prototype.hasOwnProperty.call(methods, name) && typeof proto[name] !== "function") {
            try { Object.defineProperty(proto, name, { value: methods[name], writable: true, configurable: true }); } catch (e) {}
          }
        }
      }
      if (typeof IteratorCtor.prototype[Symbol.iterator] !== "function") {
        try { Object.defineProperty(IteratorCtor.prototype, Symbol.iterator, { value: function () { return this; }, writable: true, configurable: true }); } catch (e) {}
      }
      try { Object.defineProperty(IteratorCtor.prototype, Symbol.toStringTag, { value: "Iterator", configurable: true }); } catch (e) {}

      if (typeof IteratorCtor.from !== "function") {
        IteratorCtor.from = function (value) {
          var it = toIterator(value);
          return (typeof it.map === "function") ? it : wrap(function () { return it.next(); });
        };
      }
      if (typeof IteratorCtor.concat !== "function") {
        IteratorCtor.concat = function () {
          var iterables = Array.prototype.slice.call(arguments);
          var index = 0;
          var inner = null;
          return wrap(function () {
            for (;;) {
              if (inner) { var r = inner.next(); if (!r.done) return r; inner = null; }
              if (index >= iterables.length) return { value: undefined, done: true };
              inner = toIterator(iterables[index++]);
            }
          });
        };
      }
    })();

    /* ---------- 其他较新 API 的轻量补齐（覆盖更老的 WebView / 国产 ROM 定制内核） ---------- */
    (function () {
      var Agg = typeof AggregateError === "function" ? AggregateError : Error;
      // structuredClone (Chromium 98+)
      if (typeof g.structuredClone !== "function") {
        g.structuredClone = function (value) { return JSON.parse(JSON.stringify(value)); };
      }
      // Object.hasOwn (93+)
      if (typeof Object.hasOwn !== "function") {
        Object.defineProperty(Object, "hasOwn", { configurable: true, writable: true, value: function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); } });
      }
      // Array/String.prototype.at (92+)
      if (typeof Array.prototype.at !== "function") {
        Object.defineProperty(Array.prototype, "at", { configurable: true, writable: true, value: function (n) { var i = Math.trunc(n) || 0; if (i < 0) i += this.length; return i < 0 || i >= this.length ? undefined : this[i]; } });
      }
      if (typeof String.prototype.at !== "function") {
        Object.defineProperty(String.prototype, "at", { configurable: true, writable: true, value: function (n) { var i = Math.trunc(n) || 0; if (i < 0) i += this.length; return i < 0 || i >= this.length ? undefined : this.charAt(i); } });
      }
      // String.prototype.replaceAll (85+)
      if (typeof String.prototype.replaceAll !== "function") {
        Object.defineProperty(String.prototype, "replaceAll", { configurable: true, writable: true, value: function (search, replace) {
          return this.split(search).join(replace);
        } });
      }
      // findLast / findLastIndex (97+)
      if (typeof Array.prototype.findLast !== "function") {
        Object.defineProperty(Array.prototype, "findLast", { configurable: true, writable: true, value: function (fn, thisArg) { for (var i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return this[i]; return undefined; } });
      }
      if (typeof Array.prototype.findLastIndex !== "function") {
        Object.defineProperty(Array.prototype, "findLastIndex", { configurable: true, writable: true, value: function (fn, thisArg) { for (var i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return i; return -1; } });
      }
      // 不可变数组方法 (110+)
      var immutables = {
        toReversed: function () { return this.slice().reverse(); },
        toSorted: function (cmp) { return this.slice().sort(cmp); },
        toSpliced: function () { var a = this.slice(); a.splice.apply(a, arguments); return a; },
        with: function (i, v) { var a = this.slice(); var idx = Math.trunc(i) || 0; if (idx < 0) idx += a.length; if (idx < 0 || idx >= a.length) throw new RangeError("Invalid index"); a[idx] = v; return a; }
      };
      for (var name in immutables) {
        if (typeof Array.prototype[name] !== "function") {
          Object.defineProperty(Array.prototype, name, { configurable: true, writable: true, value: immutables[name] });
        }
      }
      // Promise.any (85+)
      if (typeof Promise.any !== "function") {
        Promise.any = function (iterable) {
          return new Promise(function (resolve, reject) {
            var items = Array.from(iterable);
            var errors = [];
            var done = false;
            if (items.length === 0) { reject(new Agg([], "All promises were rejected")); return; }
            var left = items.length;
            items.forEach(function (p, i) {
              Promise.resolve(p).then(function (v) { if (!done) { done = true; resolve(v); } }, function (e) {
                errors[i] = e; left--;
                if (left === 0 && !done) { reject(new Agg(errors, "All promises were rejected")); }
              });
            });
          });
        };
      }
      // Object.groupBy / Map.groupBy (117+)
      if (typeof Object.groupBy !== "function") {
        Object.groupBy = function (items, keyFn) {
          var out = Object.create(null);
          var i = 0;
          for (var item of items) { var k = keyFn(item, i++); (out[k] = out[k] || []).push(item); }
          return out;
        };
      }
      if (typeof Map.groupBy !== "function") {
        Map.groupBy = function (items, keyFn) {
          var out = new Map();
          var i = 0;
          for (var item of items) { var k = keyFn(item, i++); if (!out.has(k)) out.set(k, []); out.get(k).push(item); }
          return out;
        };
      }
      // Set 集合运算 (122+)
      var setOps = {
        union: function (other) { var s = new Set(this); for (var v of other) s.add(v); return s; },
        intersection: function (other) { var s = new Set(); for (var v of other) if (this.has(v)) s.add(v); return s; },
        difference: function (other) { var s = new Set(this); for (var v of other) s.delete(v); return s; },
        symmetricDifference: function (other) { var s = new Set(this); for (var v of other) { if (s.has(v)) s.delete(v); else s.add(v); } return s; },
        isSubsetOf: function (other) { for (var v of this) if (!other.has(v)) return false; return true; },
        isSupersetOf: function (other) { for (var v of other) if (!this.has(v)) return false; return true; },
        isDisjointFrom: function (other) { for (var v of this) if (other.has(v)) return false; return true; }
      };
      for (var op in setOps) {
        if (typeof Set.prototype[op] !== "function") {
          Object.defineProperty(Set.prototype, op, { configurable: true, writable: true, value: setOps[op] });
        }
      }
      // AbortSignal.timeout / any (103+ / 116+)
      if (typeof AbortSignal !== "undefined") {
        if (typeof AbortSignal.timeout !== "function") {
          AbortSignal.timeout = function (ms) {
            var c = new AbortController();
            setTimeout(function () {
              try { c.abort(new DOMException("TimeoutError", "TimeoutError")); } catch (e) { c.abort(); }
            }, ms);
            return c.signal;
          };
        }
        if (typeof AbortSignal.any !== "function") {
          AbortSignal.any = function (signals) {
            var c = new AbortController();
            for (var s of signals) {
              if (s.aborted) { c.abort(s.reason); break; }
              s.addEventListener("abort", function () { c.abort(this.reason); }, { once: true });
            }
            return c.signal;
          };
        }
      }
    })();

  } catch (e) {
    try { console.warn("webview-compat: polyfill failed", e); } catch (e2) {}
  }
})();

/**
 * 移动端软键盘适配 v0.3（对应 APK v1.3.1）
 * v0.2（历史）：VisualViewport + translateY 方案，竖屏横屏通用，
 *   rAF 节流 + 异常保护，暴露 --kb-height 供 CSS 使用。
 * v0.3 新增（v1.3.1）：键盘防自动聚焦 —— 用 pointerdown 位置判断焦点来源，
 *   切换话题/新会话自动聚焦输入框时立即 blur（不弹键盘），
 *   只有用户真的点击输入框才弹键盘。
 * 注：窄屏侧栏改造（三条杠 + 浮层）在核心源码 dsh-client-ui-layout，不在此文件。
 */
(function () {
  if (!window.visualViewport) return;
  var vv = window.visualViewport;
  var app = document.getElementById('root') || document.body;
  var lastKb = 0;
  var rafId = 0;
  var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };

  function computeKb() {
    // 键盘高度 ≈ 布局视口高度 - 视觉视口高度 - 视觉视口顶部偏移
    var kb = window.innerHeight - vv.height - vv.offsetTop;
    return Math.max(0, Math.round(kb));
  }

  function apply() {
    var kb = computeKb();
    if (Math.abs(kb - lastKb) < 6) return;
    lastKb = kb;
    document.documentElement.style.setProperty('--kb-height', kb + 'px');
    if (!app) return;
    if (kb > 120) {
      // 键盘弹出：把 App 容器向上平移，露出底部输入栏
      app.style.transform = 'translateY(' + (-kb) + 'px)';
      app.style.transition = 'transform 0.12s ease-out';
      document.documentElement.classList.add('kb-open');
    } else {
      // 键盘收起：恢复原位
      app.style.transform = '';
      app.style.transition = 'transform 0.12s ease-out';
      document.documentElement.classList.remove('kb-open');
    }
  }

  function schedule() {
    if (rafId) return;
    rafId = raf(function () {
      rafId = 0;
      apply();
    });
  }

  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', function () {
    // 旋转后等布局稳定再算一次
    setTimeout(schedule, 200);
  });
  // 记录用户最后一次真实点击（pointerdown）位置，用于区分
  // 「用户主动点击输入框」与「程序化聚焦」（如切换新话题后输入框自动 focus）
  var lastPointer = null;
  document.addEventListener('pointerdown', function (e) {
    lastPointer = { x: e.clientX, y: e.clientY, t: Date.now() };
  }, true);

  function isInputLike(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  document.addEventListener('focusin', function (e) {
    var t = e && e.target;
    if (!isInputLike(t)) return;
    // 判断这次聚焦是否由用户直接点击该输入框产生
    var userTapped = false;
    if (lastPointer && Date.now() - lastPointer.t < 800) {
      var r = t.getBoundingClientRect();
      userTapped = r.left <= lastPointer.x && lastPointer.x <= r.right &&
                   r.top <= lastPointer.y && lastPointer.y <= r.bottom;
    }
    if (!userTapped) {
      // 程序化聚焦（切换话题/新会话自动 focus）：立即失焦，避免键盘自动弹出
      setTimeout(function () {
        if (document.activeElement === t) t.blur();
      }, 0);
      return;
    }
    setTimeout(schedule, 150);
  });
  document.addEventListener('focusout', function (e) {
    if (isInputLike(e && e.target)) setTimeout(schedule, 150);
  });

  // 初始计算（等待首帧布局稳定）
  setTimeout(schedule, 100);
})();

// 注：插件按钮已改为核心实现（dsh-client-ui-cordis 注册到
// conversation.session.header.utilities，单一实例），由核心渲染；
// 位置用 mobile.css 的 position:fixed 挪到三条杠下方（不动 DOM，
// 保证 React 事件委托有效）。
