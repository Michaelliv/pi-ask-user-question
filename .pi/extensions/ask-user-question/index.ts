/**
 * AskUserQuestion tool extension for pi.
 *
 * Implements the Claude Agent SDK AskUserQuestion shape:
 *   Input:  { questions: [{ question, header, options: [{label, description}], multiSelect }] }
 *   Output: { answers: Record<string, string> } or "User cancelled"
 *
 * Uses ctx.ui.custom() with pi-tui primitives for the interactive UI.
 */

import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	Container,
	type Component,
	Key,
	matchesKey,
	Spacer,
	Text,
	type TUI,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@mariozechner/pi-tui";

// ── Types ──

interface QuestionOption {
	label: string;
	description: string;
}

interface Question {
	question: string;
	header: string;
	options: QuestionOption[];
	multiSelect: boolean;
}

interface AskInput {
	questions: Question[];
}

type Answers = Record<string, string>;

// ── Helpers ──

// ── MultiSelectList component ──

class MultiSelectList implements Component {
	private options: QuestionOption[];
	private theme: Theme;
	private selectedIndex = 0;
	private checked = new Set<number>();
	private cachedWidth?: number;
	private cachedLines?: string[];
	private editingFreeform = false;
	private freeformText = "";
	private freeformCursor = 0;

	onCancel?: () => void;
	onSubmit?: (result: string) => void;

	constructor(options: QuestionOption[], private allowFreeform: boolean, theme: Theme) {
		this.options = options;
		this.theme = theme;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	private count(): number {
		return this.options.length + (this.allowFreeform ? 1 : 0);
	}

	private isFreeformRow(i: number): boolean {
		return this.allowFreeform && i === this.options.length;
	}

	private toggle(i: number): void {
		if (i < 0 || i >= this.options.length) return;
		this.checked.has(i) ? this.checked.delete(i) : this.checked.add(i);
	}

	handleInput(data: string): void {
		if (this.editingFreeform) {
			this.handleFreeformInput(data);
			return;
		}

		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.onCancel?.();
			return;
		}

		const n = this.count();
		if (n === 0) { this.onCancel?.(); return; }

		if (matchesKey(data, Key.up) || matchesKey(data, Key.shift("tab"))) {
			this.selectedIndex = this.selectedIndex === 0 ? n - 1 : this.selectedIndex - 1;
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.down) || matchesKey(data, Key.tab)) {
			this.selectedIndex = this.selectedIndex === n - 1 ? 0 : this.selectedIndex + 1;
			this.invalidate();
			return;
		}

		const numMatch = data.match(/^[1-9]$/);
		if (numMatch) {
			const idx = Number.parseInt(numMatch[0], 10) - 1;
			if (idx >= 0 && idx < this.options.length) {
				this.toggle(idx);
				this.selectedIndex = Math.min(idx, n - 1);
				this.invalidate();
			}
			return;
		}

		if (matchesKey(data, Key.space)) {
			if (this.isFreeformRow(this.selectedIndex)) { this.enterFreeform(); return; }
			this.toggle(this.selectedIndex);
			this.invalidate();
			return;
		}

		if (matchesKey(data, Key.enter)) {
			if (this.isFreeformRow(this.selectedIndex)) { this.enterFreeform(); return; }

			const idx = this.selectedIndex;
			if (this.checked.has(idx)) {
				const labels = Array.from(this.checked)
					.sort((a, b) => a - b)
					.map((i) => this.options[i]?.label)
					.filter((t): t is string => !!t);
				if (labels.length > 0) this.onSubmit?.(labels.join(", "));
			} else {
				this.toggle(idx);
				this.invalidate();
			}
		}
	}

	private enterFreeform(): void {
		this.editingFreeform = true;
		this.freeformText = "";
		this.freeformCursor = 0;
		this.invalidate();
	}

	private handleFreeformInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.editingFreeform = false;
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.ctrl("c"))) {
			this.onCancel?.();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const text = this.freeformText.trim();
			if (text) this.onSubmit?.(text);
			return;
		}
		if (matchesKey(data, Key.backspace)) {
			if (this.freeformCursor > 0) {
				this.freeformText = this.freeformText.slice(0, this.freeformCursor - 1) + this.freeformText.slice(this.freeformCursor);
				this.freeformCursor--;
			}
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.left)) {
			if (this.freeformCursor > 0) this.freeformCursor--;
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.right)) {
			if (this.freeformCursor < this.freeformText.length) this.freeformCursor++;
			this.invalidate();
			return;
		}
		// Printable character
		if (data.length === 1 && data >= " ") {
			this.freeformText = this.freeformText.slice(0, this.freeformCursor) + data + this.freeformText.slice(this.freeformCursor);
			this.freeformCursor++;
			this.invalidate();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const theme = this.theme;
		const n = this.count();
		const maxVis = Math.min(n, 10);

		if (n === 0) {
			this.cachedLines = [theme.fg("warning", "No options")];
			this.cachedWidth = width;
			return this.cachedLines;
		}

		const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVis / 2), n - maxVis));
		const end = Math.min(start + maxVis, n);
		const lines: string[] = [];

		for (let i = start; i < end; i++) {
			const sel = i === this.selectedIndex;
			const prefix = sel ? theme.fg("accent", "→") : " ";

			if (this.isFreeformRow(i)) {
				const num = theme.fg("dim", `${i + 1}.`);
				if (this.editingFreeform && sel) {
					const before = this.freeformText.slice(0, this.freeformCursor);
					const cursor = this.freeformCursor < this.freeformText.length ? this.freeformText[this.freeformCursor] : " ";
					const after = this.freeformText.slice(this.freeformCursor + 1);
					const input = theme.fg("text", before) + "\x1b[7m" + cursor + "\x1b[27m" + theme.fg("text", after);
					lines.push(truncateToWidth(`${prefix} ${num}     ${theme.fg("accent", theme.bold("Other:"))} ${input}`, width, ""));
				} else {
					const label = theme.fg("text", theme.bold("Other"));
					const desc = theme.fg("muted", "Type a custom answer");
					lines.push(truncateToWidth(`${prefix} ${num}     ${label} ${theme.fg("dim", "—")} ${desc}`, width, ""));
				}
				continue;
			}

			const opt = this.options[i];
			if (!opt) continue;

			const cb = this.checked.has(i) ? theme.fg("success", "[✓]") : theme.fg("dim", "[ ]");
			const num = theme.fg("dim", `${i + 1}.`);
			const title = sel ? theme.fg("accent", theme.bold(opt.label)) : theme.fg("text", theme.bold(opt.label));
			lines.push(truncateToWidth(`${prefix} ${num} ${cb} ${title}`, width, ""));

			if (sel && opt.description) {
				const indent = "      ";
				const wrapW = Math.max(10, width - indent.length);
				for (const w of wrapTextWithAnsi(opt.description, wrapW)) {
					lines.push(truncateToWidth(indent + theme.fg("muted", w), width, ""));
				}
			}

		}

		if (start > 0 || end < n) {
			lines.push(theme.fg("dim", truncateToWidth(`  (${this.selectedIndex + 1}/${n})`, width, "")));
		}

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}
}

// ── SingleSelectList ──

class SingleSelectList implements Component {
	private options: QuestionOption[];
	private theme: Theme;
	private selectedIndex = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];
	private editingFreeform = false;
	private freeformText = "";
	private freeformCursor = 0;

	onCancel?: () => void;
	onSelect?: (label: string) => void;

	constructor(options: QuestionOption[], private allowFreeform: boolean, theme: Theme) {
		this.options = options;
		this.theme = theme;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	private count(): number {
		return this.options.length + (this.allowFreeform ? 1 : 0);
	}

	private isFreeformRow(i: number): boolean {
		return this.allowFreeform && i === this.options.length;
	}

	handleInput(data: string): void {
		if (this.editingFreeform) {
			this.handleFreeformInput(data);
			return;
		}

		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.onCancel?.();
			return;
		}

		const n = this.count();
		if (n === 0) { this.onCancel?.(); return; }

		if (matchesKey(data, Key.up) || matchesKey(data, Key.shift("tab"))) {
			this.selectedIndex = this.selectedIndex === 0 ? n - 1 : this.selectedIndex - 1;
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.down) || matchesKey(data, Key.tab)) {
			this.selectedIndex = this.selectedIndex === n - 1 ? 0 : this.selectedIndex + 1;
			this.invalidate();
			return;
		}

		if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
			if (this.isFreeformRow(this.selectedIndex)) { this.enterFreeform(); return; }
			const opt = this.options[this.selectedIndex];
			if (opt) this.onSelect?.(opt.label);
			else this.onCancel?.();
		}
	}

	private enterFreeform(): void {
		this.editingFreeform = true;
		this.freeformText = "";
		this.freeformCursor = 0;
		this.invalidate();
	}

	private handleFreeformInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.editingFreeform = false;
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.ctrl("c"))) {
			this.onCancel?.();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const text = this.freeformText.trim();
			if (text) this.onSelect?.(text);
			return;
		}
		if (matchesKey(data, Key.backspace)) {
			if (this.freeformCursor > 0) {
				this.freeformText = this.freeformText.slice(0, this.freeformCursor - 1) + this.freeformText.slice(this.freeformCursor);
				this.freeformCursor--;
			}
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.left)) {
			if (this.freeformCursor > 0) this.freeformCursor--;
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.right)) {
			if (this.freeformCursor < this.freeformText.length) this.freeformCursor++;
			this.invalidate();
			return;
		}
		if (data.length === 1 && data >= " ") {
			this.freeformText = this.freeformText.slice(0, this.freeformCursor) + data + this.freeformText.slice(this.freeformCursor);
			this.freeformCursor++;
			this.invalidate();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const theme = this.theme;
		const n = this.count();
		const maxVis = Math.min(n, 10);

		if (n === 0) {
			this.cachedLines = [theme.fg("warning", "No options")];
			this.cachedWidth = width;
			return this.cachedLines;
		}

		const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVis / 2), n - maxVis));
		const end = Math.min(start + maxVis, n);
		const lines: string[] = [];

		for (let i = start; i < end; i++) {
			const sel = i === this.selectedIndex;
			const prefix = sel ? theme.fg("accent", "→") : " ";

			if (this.isFreeformRow(i)) {
				const num = theme.fg("dim", `${i + 1}.`);
				if (this.editingFreeform && sel) {
					const before = this.freeformText.slice(0, this.freeformCursor);
					const cursor = this.freeformCursor < this.freeformText.length ? this.freeformText[this.freeformCursor] : " ";
					const after = this.freeformText.slice(this.freeformCursor + 1);
					const input = theme.fg("text", before) + "\x1b[7m" + cursor + "\x1b[27m" + theme.fg("text", after);
					lines.push(truncateToWidth(`${prefix} ${num} ${theme.fg("accent", theme.bold("Other:"))} ${input}`, width, ""));
				} else {
					const label = theme.fg("text", theme.bold("Other"));
					const desc = theme.fg("muted", "Type a custom answer");
					lines.push(truncateToWidth(`${prefix} ${num} ${label} ${theme.fg("dim", "—")} ${desc}`, width, ""));
				}
				continue;
			}

			const opt = this.options[i];
			if (!opt) continue;

			const num = theme.fg("dim", `${i + 1}.`);
			const title = sel ? theme.fg("accent", theme.bold(opt.label)) : theme.fg("text", theme.bold(opt.label));
			lines.push(truncateToWidth(`${prefix} ${num} ${title}`, width, ""));

			if (sel && opt.description) {
				const indent = "      ";
				const wrapW = Math.max(10, width - indent.length);
				for (const w of wrapTextWithAnsi(opt.description, wrapW)) {
					lines.push(truncateToWidth(indent + theme.fg("muted", w), width, ""));
				}
			}


		}

		if (start > 0 || end < n) {
			lines.push(theme.fg("dim", truncateToWidth(`  (${this.selectedIndex + 1}/${n})`, width, "")));
		}

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}
}

// ── Single question UI component ──

class QuestionComponent extends Container {
	private question: Question;
	private tui: TUI;
	private theme: Theme;
	private onDone: (answer: string | null) => void;

	private modeContainer: Container;
	private helpText: Text;

	private selectList?: SingleSelectList;
	private multiSelectList?: MultiSelectList;

	private _focused = false;
	get focused(): boolean { return this._focused; }
	set focused(v: boolean) {
		this._focused = v;
	}

	constructor(question: Question, tui: TUI, theme: Theme, onDone: (answer: string | null) => void, borderless = false) {
		super();
		this.question = question;
		this.tui = tui;
		this.theme = theme;
		this.onDone = onDone;

		// Layout — compact. Top divider only (no full box), merged header + question,
		// the options list, and a help line.
		if (!borderless) {
			this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		}

		this.addChild(new Text(
			`${theme.fg("accent", theme.bold(question.header))} ${theme.fg("dim", "—")} ${theme.fg("text", question.question)}`,
			1, 0,
		));

		// Mode container (select or freeform)
		this.modeContainer = new Container();
		this.addChild(this.modeContainer);

		if (!borderless) {
			this.helpText = new Text("", 1, 0);
			this.addChild(this.helpText);
		}

		this.showSelectMode();
	}

	override render(width: number): string[] {
		return super.render(width).map((l) => truncateToWidth(l, width, ""));
	}

	private updateHelp(): void {
		if (!this.helpText) return;
		const t = this.theme;
		if (this.question.multiSelect) {
			this.helpText.setText(t.fg("dim", "↑↓ navigate • space toggle • enter submit • esc cancel"));
		} else {
			this.helpText.setText(t.fg("dim", "↑↓ navigate • enter select • esc cancel"));
		}
	}

	private showSelectMode(): void {
		this.modeContainer.clear();

		if (this.question.multiSelect) {
			this.modeContainer.addChild(this.ensureMultiSelect());
		} else {
			this.modeContainer.addChild(this.ensureSingleSelect());
		}
		this.updateHelp();
		this.invalidate();
		this.tui.requestRender();
	}

	private ensureSingleSelect(): SingleSelectList {
		if (this.selectList) return this.selectList;

		const sl = new SingleSelectList(this.question.options, true, this.theme);
		sl.onSelect = (label) => this.onDone(label);
		sl.onCancel = () => this.onDone(null);
		this.selectList = sl;
		return sl;
	}

	private ensureMultiSelect(): MultiSelectList {
		if (this.multiSelectList) return this.multiSelectList;
		const ml = new MultiSelectList(this.question.options, true, this.theme);
		ml.onCancel = () => this.onDone(null);
		ml.onSubmit = (result) => this.onDone(result);
		this.multiSelectList = ml;
		return ml;
	}

	handleInput(data: string): void {
		if (this.question.multiSelect) {
			this.ensureMultiSelect().handleInput?.(data);
		} else {
			this.ensureSingleSelect().handleInput?.(data);
		}
		this.tui.requestRender();
	}
}

// ── Tabbed question navigator ──
// Left/right to switch tabs, up/down + enter handled by the active QuestionComponent.
// Each question remembers its answer. Submit when all are answered, or press ctrl+enter to submit early.

class TabbedQuestions extends Container {
	private questions: Question[];
	private tui: TUI;
	private theme: Theme;
	private onDone: (answers: Answers | null) => void;

	private activeTab = 0;
	private answers: (string | null)[];
	private questionComponents: QuestionComponent[] = [];

	// Layout pieces
	private tabBar: Text;
	private bodyContainer: Container;
	private helpText: Text;

	private _focused = false;
	get focused(): boolean { return this._focused; }
	set focused(v: boolean) {
		this._focused = v;
		const qc = this.questionComponents[this.activeTab];
		if (qc) (qc as any).focused = v;
	}

	constructor(questions: Question[], tui: TUI, theme: Theme, onDone: (answers: Answers | null) => void) {
		super();
		this.questions = questions;
		this.tui = tui;
		this.theme = theme;
		this.onDone = onDone;
		this.answers = new Array(questions.length).fill(null);

		// Top border
		this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		this.addChild(new Spacer(1));

		// Tab bar
		this.tabBar = new Text("", 1, 0);
		this.addChild(this.tabBar);
		this.addChild(new Spacer(1));

		// Body — holds the active QuestionComponent (without its own borders)
		this.bodyContainer = new Container();
		this.addChild(this.bodyContainer);

		this.addChild(new Spacer(1));

		// Help
		this.helpText = new Text("", 1, 0);
		this.addChild(this.helpText);
		this.addChild(new Spacer(1));

		// Bottom border
		this.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		// Build all QuestionComponents (borderless — we wrap them)
		for (let i = 0; i < questions.length; i++) {
			const qc = this.createQuestionBody(questions[i], i);
			this.questionComponents.push(qc);
		}

		this.showTab(0);
	}

	private createQuestionBody(q: Question, index: number): QuestionComponent {
		const qc = new QuestionComponent(q, this.tui, this.theme, (answer) => {
			this.answers[index] = answer;
			this.updateTabBar();

			if (answer === null) {
				// Cancel on this question — cancel everything
				this.onDone(null);
				return;
			}

			// Auto-advance to next unanswered tab, or submit if all done
			const nextUnanswered = this.answers.findIndex((a) => a === null);
			if (nextUnanswered === -1) {
				this.submitAll();
			} else {
				this.showTab(nextUnanswered);
			}
		}, true); // borderless — TabbedQuestions provides the outer border
		return qc;
	}

	private showTab(index: number): void {
		this.activeTab = index;
		this.bodyContainer.clear();

		const qc = this.questionComponents[index];
		if (qc) {
			(qc as any).focused = this._focused;
			this.bodyContainer.addChild(qc);
		}

		this.updateTabBar();
		this.updateHelp();
		this.invalidate();
		this.tui.requestRender();
	}

	private updateTabBar(): void {
		const t = this.theme;
		const parts = this.questions.map((q, i) => {
			const header = q.header;
			const answered = this.answers[i] !== null;
			const active = i === this.activeTab;

			let label: string;
			if (active) {
				label = t.fg("accent", t.bold(`[ ${header} ]`));
			} else if (answered) {
				label = t.fg("success", `  ${header} ✓ `);
			} else {
				label = t.fg("dim", `  ${header}  `);
			}
			return label;
		});
		this.tabBar.setText(parts.join(t.fg("dim", "│")));
	}

	private updateHelp(): void {
		const t = this.theme;
		const q = this.questions[this.activeTab];
		const base = q?.multiSelect
			? "↑↓ navigate • space toggle • enter submit"
			: "↑↓ navigate • enter select";

		const nav = this.questions.length > 1 ? " • ←→ switch tab" : "";
		const submit = this.answers.some((a) => a !== null) ? " • ctrl+s submit all" : "";
		this.helpText.setText(t.fg("dim", `${base}${nav}${submit} • esc cancel`));
	}

	private submitAll(): void {
		const result: Answers = {};
		for (let i = 0; i < this.questions.length; i++) {
			const a = this.answers[i];
			if (a !== null) {
				result[this.questions[i].question] = a;
			}
		}
		// If nothing answered at all, treat as cancel
		if (Object.keys(result).length === 0) {
			this.onDone(null);
		} else {
			this.onDone(result);
		}
	}

	override render(width: number): string[] {
		return super.render(width).map((l) => truncateToWidth(l, width, ""));
	}

	handleInput(data: string): void {
		// Global: left/right to switch tabs
		if (matchesKey(data, Key.left) && this.questions.length > 1) {
			const prev = this.activeTab === 0 ? this.questions.length - 1 : this.activeTab - 1;
			this.showTab(prev);
			return;
		}

		if (matchesKey(data, Key.right) && this.questions.length > 1) {
			const next = this.activeTab === this.questions.length - 1 ? 0 : this.activeTab + 1;
			this.showTab(next);
			return;
		}

		// Ctrl+S to submit all answered so far
		if (matchesKey(data, Key.ctrl("s"))) {
			this.submitAll();
			return;
		}

		// Ctrl+C to cancel everything
		if (matchesKey(data, Key.ctrl("c"))) {
			this.onDone(null);
			return;
		}

		// Delegate to active question
		const qc = this.questionComponents[this.activeTab];
		qc?.handleInput(data);
	}
}

// ── Extension entry point ──

export default function (pi: ExtensionAPI) {
	// Inject AskUserQuestion guidelines into the system prompt each turn
	pi.on("before_agent_start", async (event) => {
		const guidelines = `

## AskUserQuestion Tool

Use this tool when you need to ask the user questions during execution. This allows you to:
- Gather user preferences or requirements
- Clarify ambiguous instructions
- Get decisions on implementation choices as you work
- Offer choices to the user about what direction to take

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label
`;
		return { systemPrompt: event.systemPrompt + guidelines };
	});

	pi.registerTool({
		name: "AskUserQuestion",
		label: "Ask User",
		description:
			"Ask the user 1-4 clarifying questions with multiple-choice options (2-4 each). " +
			"Use when requirements are ambiguous, multiple valid approaches exist, or you need " +
			"explicit user preference before proceeding. Each question has a short header, " +
			"the question text, options with labels and descriptions, and a multiSelect flag.",
		parameters: Type.Object({
			questions: Type.Array(
				Type.Object({
					question: Type.String({ description: "The full question text to display" }),
					header: Type.String({ description: "Short label for the question (max 12 chars)" }),
					options: Type.Array(
						Type.Object({
							label: Type.String({ description: "Short option label" }),
							description: Type.String({ description: "Longer description of this option" }),
						}),
						{ description: "2-4 choices", minItems: 2, maxItems: 4 },
					),
					multiSelect: Type.Boolean({ description: "If true, user can select multiple options" }),
				}),
				{ description: "1-4 questions to ask", minItems: 1, maxItems: 4 },
			),
		}),

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) {
				return { content: [{ type: "text", text: "Cancelled" }] };
			}

			const { questions } = params as AskInput;

			// Non-interactive fallback
			if (!ctx.hasUI || !ctx.ui) {
				const formatted = questions
					.map((q, i) => {
						const opts = q.options.map((o, j) => `  ${j + 1}. ${o.label} — ${o.description}`).join("\n");
						return `${i + 1}. [${q.header}] ${q.question}\n${opts}`;
					})
					.join("\n\n");

				return {
					content: [{
						type: "text",
						text: `AskUserQuestion requires interactive mode. Questions:\n\n${formatted}`,
					}],
					isError: true,
				};
			}

			let result: Answers | null;

			// Render as an overlay anchored to the bottom-left of the terminal,
			// full width, natural height. This sits where the editor normally is,
			// avoids pushing chat history around, and sidesteps the differential
			// renderer's full-redraw path when total inline content exceeds terminal height.
			const overlayOptions = {
				overlay: true as const,
				overlayOptions: {
					width: "100%" as const,
					maxHeight: "80%" as const,
					anchor: "bottom-left" as const,
				},
			};

			try {
				if (questions.length === 1) {
					const q = questions[0];
					const answer = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
						return new QuestionComponent(q, tui, theme, done);
					}, overlayOptions);
					result = answer !== null ? { [q.question]: answer } : null;
				} else {
					result = await ctx.ui.custom<Answers | null>((tui, theme, _kb, done) => {
						return new TabbedQuestions(questions, tui, theme, done);
					}, overlayOptions);
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `AskUserQuestion failed: ${msg}` }],
					isError: true,
				};
			}

			if (result === null) {
				return { content: [{ type: "text", text: "User cancelled the question" }] };
			}

			// Format answers for the LLM
			const lines = Object.entries(result)
				.map(([q, a]) => `Q: ${q}\nA: ${a}`)
				.join("\n\n");

			return {
				content: [{ type: "text", text: lines }],
				details: { questions, answers: result },
			};
		},
	});
}
