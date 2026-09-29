// The formula grammar: a tokenizer and a Pratt parser from text to AST.
//
// Grammar: numbers, `+ - * /`, unary minus, parentheses, the variables `duration` and
// `enemies`, `$name` references to the bonus's named formulas and number inputs, and calls to
// FUNCTIONS. String literals are only valid as an id or path argument, since ids contain `-`.

import { span, type BinaryOperator, type FormulaNode, type Span } from "./ast";

type Token = Span &
  (
    | { type: "number"; value: number }
    | { type: "string"; value: string }
    | { type: "identifier"; value: string }
    | { type: "named"; value: string }
    | { type: "punct"; value: string }
    | { type: "end" }
  );

export class ParseError extends Error {
  constructor(
    message: string,
    readonly span: Span,
  ) {
    super(message);
  }
}

const IDENTIFIER = /[a-zA-Z_]\w*/y;

/** Whether `name` can be declared as a named formula and referenced as `$name`. */
export const isFormulaName = (name: string) => /^[a-zA-Z_]\w*$/.test(name);
const NUMBER = /(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/y;

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const match = (pattern: RegExp) => {
    pattern.lastIndex = i;
    return pattern.exec(text)?.[0] ?? null;
  };
  while (i < text.length) {
    const char = text[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    const start = i;
    if (/[\d.]/.test(char)) {
      const raw = match(NUMBER);
      if (!raw)
        throw new ParseError(`unexpected "${char}"`, { start, end: i + 1 });
      i += raw.length;
      tokens.push({ type: "number", value: Number(raw), start, end: i });
    } else if (/[a-zA-Z_]/.test(char)) {
      const raw = match(IDENTIFIER)!;
      i += raw.length;
      tokens.push({ type: "identifier", value: raw, start, end: i });
    } else if (char === "$") {
      i++;
      const raw = match(IDENTIFIER);
      if (!raw)
        throw new ParseError(
          '"$" must be followed by a formula or input name',
          {
            start,
            end: i,
          },
        );
      i += raw.length;
      tokens.push({ type: "named", value: raw, start, end: i });
    } else if (char === '"' || char === "'") {
      const close = text.indexOf(char, i + 1);
      if (close === -1)
        throw new ParseError("unterminated string", {
          start,
          end: text.length,
        });
      i = close + 1;
      tokens.push({
        type: "string",
        value: text.slice(start + 1, close),
        start,
        end: i,
      });
    } else if ("+-*/(),".includes(char)) {
      i++;
      tokens.push({ type: "punct", value: char, start, end: i });
    } else {
      throw new ParseError(`unexpected "${char}"`, { start, end: i + 1 });
    }
  }
  tokens.push({ type: "end", start: text.length, end: text.length });
  return tokens;
}

// Pratt parser

const BINDING: Record<string, number> = { "+": 10, "-": 10, "*": 20, "/": 20 };
const PREFIX_BINDING = 30;

const describeToken = (token: Token) =>
  token.type === "end"
    ? "end of formula"
    : `"${"value" in token ? token.value : ""}"`;

export function parseTokens(tokens: Token[]): FormulaNode {
  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];
  const isPunct = (token: Token, value: string) =>
    token.type === "punct" && token.value === value;
  const expect = (value: string) => {
    const token = next();
    if (!isPunct(token, value))
      throw new ParseError(
        `expected "${value}", found ${describeToken(token)}`,
        token,
      );
    return token;
  };

  const prefix = (): FormulaNode => {
    const token = next();
    switch (token.type) {
      case "number":
        return { kind: "number", value: token.value, ...span(token) };
      case "string":
        return { kind: "string", value: token.value, ...span(token) };
      case "named":
        return { kind: "named", name: token.value, ...span(token) };
      case "identifier": {
        if (!isPunct(peek(), "("))
          return { kind: "variable", name: token.value, ...span(token) };
        next();
        const args: FormulaNode[] = [];
        if (!isPunct(peek(), ")")) {
          args.push(expression(0));
          while (isPunct(peek(), ",")) {
            next();
            args.push(expression(0));
          }
        }
        const close = expect(")");
        return {
          kind: "call",
          name: token.value,
          args,
          start: token.start,
          end: close.end,
        };
      }
      case "punct":
        if (token.value === "-") {
          const operand = expression(PREFIX_BINDING);
          return {
            kind: "negate",
            operand,
            start: token.start,
            end: operand.end,
          };
        }
        if (token.value === "(") {
          const inner = expression(0);
          const close = expect(")");
          return { ...inner, start: token.start, end: close.end };
        }
        break;
    }
    throw new ParseError(
      token.type === "end"
        ? "formula ends early"
        : `unexpected ${describeToken(token)}`,
      token,
    );
  };

  const expression = (minBinding: number): FormulaNode => {
    let left = prefix();
    for (;;) {
      const token = peek();
      if (token.type !== "punct") break;
      const binding = BINDING[token.value];
      if (binding === undefined || binding <= minBinding) break;
      next();
      const right = expression(binding);
      left = {
        kind: "binary",
        op: token.value as BinaryOperator,
        left,
        right,
        start: left.start,
        end: right.end,
      };
    }
    return left;
  };

  const tree = expression(0);
  const rest = peek();
  if (rest.type !== "end")
    throw new ParseError(`unexpected ${describeToken(rest)}`, rest);
  return tree;
}
