#!/usr/bin/env python3
"""Interactive CLI to test the LLM tool-calling spike (Task 1.3.2).

Usage:
    cd backend
    python -m scripts.run_llm_spike                     # mock provider (default)
    LLM_PROVIDER=google python -m scripts.run_llm_spike  # live Google GenAI

The script creates an orchestrator and runs an interactive chat loop.
Type 'quit' or 'exit' to stop. Type 'context' to view/change context.
"""

from __future__ import annotations

import json
import sys
import os

# Ensure the backend package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.config import get_settings
from app.llm.orchestrator import LLMOrchestrator
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


def main():
    print("=" * 60)
    print("  Vinergy LLM Tool Calling Spike (Task 1.3.2)")
    print("=" * 60)

    settings = get_settings()
    provider_name = settings.llm_provider or "mock"
    print(f"  Provider: {provider_name}")
    print(f"  Model:    {settings.llm_model or '(mock)'}")
    print(f"  Timeout:  {settings.llm_timeout_ms} ms")
    print(f"  Max tool rounds: {settings.llm_max_tool_rounds}")
    print("-" * 60)
    print("Commands: 'quit', 'exit', 'context', 'set location <lat> <lng>',")
    print("          'set family <FAM_A|FAM_B>', 'clear context'")
    print("-" * 60)

    provider = _create_provider()
    orchestrator = LLMOrchestrator(provider)

    # Default context: LOC-01, FAM_A
    context = {
        "location": {"lat": 21.005, "lng": 105.8435},
        "family_code": "FAM_A",
    }
    print(f"  Default context: {json.dumps(context, ensure_ascii=False)}")
    print()

    while True:
        try:
            user_input = input("Bạn: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nTạm biệt!")
            break

        if not user_input:
            continue
        if user_input.lower() in ("quit", "exit"):
            print("Tạm biệt!")
            break
        if user_input.lower() == "context":
            print(f"  Context: {json.dumps(context, ensure_ascii=False)}")
            continue
        if user_input.lower() == "clear context":
            context = {}
            print("  Context cleared.")
            continue
        if user_input.lower().startswith("set location "):
            parts = user_input.split()
            if len(parts) >= 4:
                try:
                    lat, lng = float(parts[2]), float(parts[3])
                    context["location"] = {"lat": lat, "lng": lng}
                    print(f"  Location set to ({lat}, {lng})")
                except ValueError:
                    print("  Invalid coordinates.")
            continue
        if user_input.lower().startswith("set family "):
            fc = user_input.split()[-1].upper()
            if fc in ("FAM_A", "FAM_B"):
                context["family_code"] = fc
                print(f"  Family set to {fc}")
            else:
                print("  Invalid family code. Use FAM_A or FAM_B.")
            continue

        # --- Run orchestrator ---
        result = orchestrator.handle(message=user_input, context=context)

        print(f"\nTrợ lý: {result.reply}")
        if result.tool_results:
            print(f"\n  [Tool results: {len(result.tool_results)} call(s)]")
            for tr in result.tool_results:
                tool_name = tr.get("tool", "?")
                ok = tr.get("ok", False)
                if ok:
                    data = tr.get("data", {})
                    if "stations" in data:
                        print(f"    {tool_name}: {data['total']} station(s) found")
                    elif "station" in data:
                        s = data["station"]
                        print(f"    {tool_name}: {s['station_id']} — {s['name']}")
                else:
                    err = tr.get("error", {})
                    print(f"    {tool_name}: ERROR {err.get('code')} — {err.get('message')}")
        if result.fallback:
            print(f"  [Fallback: {result.fallback}]")

        m = result.metrics.summary()
        print(f"  [Timing: total={m['total_ms']:.0f}ms, "
              f"llm={m['llm_total_ms']:.0f}ms ({m['llm_calls']} call(s)), "
              f"tool={m['tool_total_ms']:.0f}ms ({m['tool_calls']} call(s))]")
        print()


if __name__ == "__main__":
    main()
