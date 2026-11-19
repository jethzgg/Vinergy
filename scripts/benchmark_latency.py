#!/usr/bin/env python3
"""Latency benchmark script for LLM tool calling (NFR-06, EN-105).

Measures:
- T_llm: Turnaround time for LLM provider response.
- T_tool: Execution time of the backend search/detail tool.
- T_total: End-to-end response time.

Calculates median and p95 percentiles across multiple sample iterations.
"""

from __future__ import annotations

import math
import os
import statistics
import sys
import time

# Ensure backend package is in path
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.core.config import get_settings
from app.llm.orchestrator import LLMOrchestrator
from app.llm.providers.base import ProviderConfigurationError
from app.llm.providers.mock_provider import MockLLMProvider


def _create_provider():
    settings = get_settings()
    provider_name = (settings.llm_provider or "mock").lower()
    if provider_name == "google":
        from app.llm.providers.google_genai import GoogleGenAIProvider
        return GoogleGenAIProvider(
            api_key=settings.llm_api_key,
            model=settings.llm_model or "gemini-2.5-flash",
            timeout_ms=settings.llm_timeout_ms,
        )
    return MockLLMProvider()


def run_benchmark(iterations: int = 30):
    provider = _create_provider()
    orchestrator = LLMOrchestrator(provider)
    settings = get_settings()

    provider_name = settings.llm_provider or "mock"
    print(f"=== Running Latency Benchmark (NFR-06) ===")
    print(f"Provider: {provider_name}")
    print(f"Model: {settings.llm_model or '(mock)'}")
    print(f"Sample size: {iterations} iterations\n")

    test_queries = [
        ("Tìm trạm đổi pin gần nhất", {"location": {"lat": 21.005, "lng": 105.8435}, "family_code": "FAM_A"}),
        ("Chi tiết trạm ST-04", {"location": {"lat": 21.005, "lng": 105.8435}, "family_code": "FAM_A"}),
        ("Tìm trạm sạc cho tôi", {"location": {"lat": 21.0285, "lng": 105.8542}, "family_code": "FAM_B"}),
        ("ST-01", {"location": {"lat": 21.005, "lng": 105.8435}, "family_code": "FAM_A"}),
    ]

    total_times = []
    llm_times = []
    tool_times = []
    failures = 0

    for i in range(iterations):
        msg, ctx = test_queries[i % len(test_queries)]
        res = orchestrator.handle(message=msg, context=ctx)
        
        if res.fallback == "MANUAL_FORM":
            failures += 1

        m = res.metrics
        total_times.append(m.total_ms)
        llm_times.append(m.llm_total_ms)
        tool_times.append(m.tool_total_ms)

    def stats(arr: list[float]) -> dict[str, float]:
        if not arr:
            return {"min": 0.0, "max": 0.0, "median": 0.0, "p95": 0.0, "mean": 0.0}
        sorted_arr = sorted(arr)
        # Compute 95th percentile
        k = (len(sorted_arr) - 1) * 0.95
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            p95 = sorted_arr[int(k)]
        else:
            p95 = sorted_arr[f] * (c - k) + sorted_arr[c] * (k - f)
        return {
            "min": min(sorted_arr),
            "max": max(sorted_arr),
            "median": statistics.median(sorted_arr),
            "p95": p95,
            "mean": statistics.mean(sorted_arr),
        }

    s_total = stats(total_times)
    s_llm = stats(llm_times)
    s_tool = stats(tool_times)

    print("Results:")
    print(f"  Failures: {failures}/{iterations}")
    print(f"  Total Latency (T_total):")
    print(f"    Median: {s_total['median']:.2f} ms | p95: {s_total['p95']:.2f} ms | Min: {s_total['min']:.2f} ms | Max: {s_total['max']:.2f} ms")
    print(f"  LLM Provider Latency (T_llm):")
    print(f"    Median: {s_llm['median']:.2f} ms | p95: {s_llm['p95']:.2f} ms | Min: {s_llm['min']:.2f} ms | Max: {s_llm['max']:.2f} ms")
    print(f"  Backend Tool Latency (T_tool):")
    print(f"    Median: {s_tool['median']:.2f} ms | p95: {s_tool['p95']:.2f} ms | Min: {s_tool['min']:.2f} ms | Max: {s_tool['max']:.2f} ms")

    return {
        "iterations": iterations,
        "failures": failures,
        "total": s_total,
        "llm": s_llm,
        "tool": s_tool,
    }


if __name__ == "__main__":
    try:
        run_benchmark(30)
    except ProviderConfigurationError as error:
        raise SystemExit(str(error)) from None
