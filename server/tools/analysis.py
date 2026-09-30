"""Read-only deterministic tools. No evaluation of model-supplied code or URLs."""
from __future__ import annotations

import ast
import re
from decimal import Decimal, DecimalException, localcontext
from pydantic import BaseModel, Field, model_validator

from .contracts import ToolContext, ToolResult


class CalculatorInput(BaseModel):
    expression: str = Field(min_length=1, max_length=80)


class CompareSourcesInput(BaseModel):
    source_ids: list[str] = Field(min_length=2, max_length=3)
    question: str = Field(min_length=1, max_length=300)

    @model_validator(mode='after')
    def valid_ids(self):
        if len(set(self.source_ids)) != len(self.source_ids) or any(
            not re.fullmatch(r'S[1-9][0-9]*', sid) for sid in self.source_ids
        ):
            raise ValueError('source IDs must be unique public sources')
        return self


async def calculator(context: ToolContext, params: CalculatorInput) -> ToolResult:
    try:
        tree = ast.parse(params.expression, mode='eval')
        if sum(1 for _ in ast.walk(tree)) > 32:
            raise ValueError('expression too complex')

        def compute(node, depth=0):
            if depth > 8:
                raise ValueError('expression too deep')
            if isinstance(node, ast.Expression):
                return compute(node.body, depth + 1)
            if isinstance(node, ast.Constant) and type(node.value) in (int, float):
                value = Decimal(str(node.value))
            elif isinstance(node, ast.UnaryOp) and type(node.op) in (ast.UAdd, ast.USub):
                value = compute(node.operand, depth + 1)
                if isinstance(node.op, ast.USub):
                    value = -value
            elif isinstance(node, ast.BinOp) and type(node.op) in (ast.Add, ast.Sub, ast.Mult, ast.Div):
                left, right = compute(node.left, depth + 1), compute(node.right, depth + 1)
                if isinstance(node.op, ast.Add):
                    value = left + right
                elif isinstance(node.op, ast.Sub):
                    value = left - right
                elif isinstance(node.op, ast.Mult):
                    value = left * right
                else:
                    value = left / right
            else:
                raise ValueError('only basic arithmetic is allowed')
            if not value.is_finite() or (value and abs(value.adjusted()) > 30):
                raise ValueError('result out of range')
            return value

        with localcontext() as decimal_context:
            decimal_context.prec = 28
            value = compute(tree)
        result = format(value.normalize(), 'f')
        if len(result) > 80:
            raise ValueError('result too long')
        return ToolResult(summary=result, data={'result': result})
    except (SyntaxError, DecimalException) as exc:
        raise ValueError('invalid arithmetic expression') from exc


async def compare_sources(context: ToolContext, params: CompareSourcesInput) -> ToolResult:
    if any(sid not in context.sources for sid in params.source_ids):
        raise ValueError('source not issued in this run')
    excerpts = [{'source_id': sid,
                 'excerpt': (context.sources[sid].get('text') or
                             context.sources[sid].get('snippet') or '')[:500]}
                for sid in params.source_ids]
    return ToolResult(summary=f'{len(excerpts)} source excerpts to review',
                      data={'question': params.question, 'sources': excerpts},
                      source_ids=params.source_ids, untrusted=True)
