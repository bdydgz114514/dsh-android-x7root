window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-settings-custom",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const Button = primitives.Button;

		const name = "client-ui-settings-custom";
		const inject = ["slots", "locale"];
		const NS = "settings.custom";

		// ---------- 原生桥（由 App 的 WebView addJavascriptInterface 注入）----------
		function bridge() {
			try { return typeof window !== "undefined" ? window.DSHNative : undefined; } catch (e) { return undefined; }
		}
		function call(method) {
			const b = bridge();
			if (!b || typeof b[method] !== "function") return undefined;
			const args = Array.prototype.slice.call(arguments, 1);
			try { return b[method].apply(b, args); } catch (e) { return undefined; }
		}
		function hasBridge() {
			const b = bridge();
			return !!(b && typeof b.getState === "function");
		}
		function readState() {
			const raw = call("getState");
			if (typeof raw !== "string" || raw.length === 0) return null;
			try { return JSON.parse(raw); } catch (e) { return null; }
		}

		// ---------- 样式：与 DSH 设置行一致的 token/尺寸 ----------
		const S = {
			row: { display: "flex", alignItems: "center", gap: "8px", padding: "16px 0", borderBottom: "0.5px solid var(--dsw-alias-border-l2)" },
			rowText: { display: "flex", flexDirection: "column", flex: "1", gap: "4px", minWidth: "0", paddingRight: "16px" },
			title: { color: "var(--dsw-alias-label-primary)", fontSize: "14px", fontWeight: 400, lineHeight: "22px" },
			desc: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", fontWeight: 400, lineHeight: "18px", wordBreak: "break-all" },
			seg: { display: "inline-flex", gap: "8px", flex: "none" },
			chip: { height: "36px", font: "inherit", cursor: "pointer", border: "1px solid var(--dsw-alias-border-l3)", borderRadius: "18px", padding: "0 14px", fontSize: "14px", lineHeight: "22px", color: "var(--dsw-alias-label-primary)", background: "transparent" },
			chipOn: { height: "36px", font: "inherit", cursor: "pointer", border: "none", borderRadius: "18px", padding: "0 14px", fontSize: "14px", lineHeight: "22px", color: "var(--dsw-alias-label-primary)", background: "var(--dsw-alias-bg-module-platform)" },
			actions: { display: "inline-flex", gap: "8px", flex: "none" },
			note: { color: "var(--dsw-alias-label-tertiary)", fontSize: "12px", lineHeight: "18px", paddingTop: "12px" }
		};

		function Row(props) {
			return react.createElement("div", { style: S.row },
				react.createElement("div", { style: S.rowText },
					react.createElement("div", { style: S.title }, props.title),
					props.desc ? react.createElement("div", { style: S.desc }, props.desc) : null),
				props.children);
		}

		function CustomSection() {
			const [state, setState] = react.useState(readState);
			react.useEffect(() => {
				const id = setInterval(() => { setState(readState()); }, 1500);
				return () => clearInterval(id);
			}, []);
			if (!hasBridge()) {
				return react.createElement("div", { style: S.note }, "未连接到 App：本页仅在「DSH 定制版」App 内可用。");
			}
			const s = state || {};
			const mode = s.runMode === "noroot" ? "noroot" : "root";
			const chip = (label, onClick, on) => react.createElement("button", { style: on ? S.chipOn : S.chip, onClick, type: "button" }, label);
			return react.createElement("div", null,
				react.createElement(Row, { title: "运行模式", desc: mode === "root" ? "有 root：使用 su 特权并注册 root 专属工具（切换后需重启引擎）" : "无 root：不使用 su，仅 Shizuku / 普通权限（切换后需重启引擎）" },
					react.createElement("div", { style: S.seg },
						chip("有 root", () => { call("setRunMode", "root"); call("requestRestart"); }, mode === "root"),
						chip("无 root", () => { call("setRunMode", "noroot"); call("requestRestart"); }, mode !== "root"))),
				react.createElement(Row, { title: "知识库", desc: (s.kbCount === undefined ? "读取中…" : ("共 " + s.kbCount + " 条")) + (s.kbDir ? (" · " + s.kbDir) : "") + "（外部存储，App 更新不会清除）" },
					react.createElement("div", { style: S.actions },
						react.createElement(Button, { variant: "outline", size: "sm", onClick: () => call("openKnowledgeDir"), children: "打开目录" }),
						react.createElement(Button, { variant: "outline", size: "sm", onClick: () => call("copyKnowledgePath"), children: "复制路径" }))),
				react.createElement(Row, { title: "检查更新", desc: "已取消每次启动自动检查；点右侧按钮手动检查" },
					react.createElement(Button, { variant: "outline", size: "sm", onClick: () => call("checkUpdate"), children: "检查更新" })),
				react.createElement(Row, { title: "关于", desc: "DSH 定制版 " + (s.appVersion || "") + " · 内核 " + (s.kernelVersion || "") + " · " + (s.packageName || "") }, null),
				react.createElement("div", { style: S.note }, "运行模式与知识库目录变更后需重启引擎生效。"));
		}

		const zh = { nav: "定制" };
		const en = { nav: "Custom" };

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "custom settings dictionary");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "custom",
				order: 5,
				label: () => t("nav"),
				locale: NS
			}, CustomSection));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
