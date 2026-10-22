
#!/usr/bin/env python3

"""
CashEdge Fantasy NBA
Five Contextual Lineups - SHADOW ONLY
"""

import json
import sys
from pathlib import Path

sys.path.insert(
    0,
    str(Path("fantasy-engine/optimizer").resolve())
)

from multi_solver import optimize_multiple
from solver import RULES

DIRECTORY = Path("fantasy-slate-data")
TARGET_DATE = "2026-10-22"
BANNED_SALARY_MAX = 3500
LINEUPS = 5


def ensure(condition, message):
    if not condition:
        raise ValueError(message)


def validate_result(
    lineup,
    player_map,
    slots,
    cap
):
    selections = (
        lineup
        if isinstance(lineup, list)
        else lineup.get(
            "lineup",
            lineup.get("players", [])
        )
    )

    ensure(
        len(selections) == len(slots),
        "Incomplete lineup"
    )

    identifiers = [
        str(selection["playerId"])
        for selection in selections
    ]

    ensure(
        len(identifiers) == len(set(identifiers)),
        "Repeated player"
    )

    ensure(
        all(pid in player_map for pid in identifiers),
        "Player outside slate"
    )

    salary = sum(
        player_map[pid]["salary"]
        for pid in identifiers
    )

    ensure(
        salary <= cap,
        "Salary cap exceeded"
    )

    ensure(
        all(
            player_map[pid]["salary"] > BANNED_SALARY_MAX
            for pid in identifiers
        ),
        "Forbidden salary"
    )

    used_slots = [
        selection["slot"]
        for selection in selections
    ]

    ensure(
        len(used_slots) == len(set(used_slots)),
        "Repeated roster slot"
    )

    for choice in selections:
        slot = choice["slot"]

        try:
            allowed = (
                slots[slot]
                if isinstance(slots, dict)
                else slots[int(slot)]
            )
        except (
            KeyError,
            ValueError,
            TypeError,
            IndexError
        ):
            raise ValueError("Unknown roster slot")

        player_positions = set(
            player_map[
                str(choice["playerId"])
            ]["positions"]
        )

        ensure(
            bool(player_positions & set(allowed)),
            "Invalid roster position"
        )

    return {
        "salary": salary,

        "expectedFantasyPoints": round(
            sum(
                player_map[pid]["projectedPoints"]
                for pid in identifiers
            ),
            2
        ),

        "startersByESPN": sum(
            player_map[pid]["depthRank"] == 1
            for pid in identifiers
        ),

        "strongReserves": sum(
            player_map[pid]["depthRank"] == 2
            for pid in identifiers
        ),

        "players": [
            {
                **player_map[str(selection["playerId"])],
                "rosterSlot": selection["slot"]
            }
            for selection in selections
        ]
    }


def main():
    for provider in ("draftkings", "fanduel"):
        source = DIRECTORY / (
            f"nba-{provider}-context-shadow.json"
        )

        if not source.exists():
            print(
                f"{provider}: no contextual slate; skipped"
            )
            continue

        report = json.loads(
            source.read_text(encoding="utf-8")
        )

        ensure(
            report["mode"] == "shadow"
            and report["date"] == TARGET_DATE
            and report["platform"] == provider,
            "Slate mismatch"
        )

        cap = RULES["nba"][provider]["salary_cap"]

        ensure(
            report["salaryCap"] == cap,
            "Salary cap differs from optimizer"
        )

        players = []

        for player in report["players"]:
            if (
                player["salary"] <= BANNED_SALARY_MAX
                or player["depthRank"] not in (1, 2)
            ):
                continue

            if not (
                player.get("gameId")
                and player.get("teamId")
                and player.get("positions")
            ):
                continue

            if player.get("capturedBeforeTipoff") is not True:
                continue

            players.append({
                "playerId": str(player["playerId"]),
                "name": player["name"],
                "teamId": str(player["teamId"]),
                "gameId": str(player["gameId"]),
                "salary": int(player["salary"]),
                "positions": player["positions"],

                "projectedPoints": float(
                    player["projectedPoints"]
                ),

                "depthRank": player["depthRank"],

                "expectedMinutes":
                    player["expectedMinutes"],

                "p10": player["simulation"]["p10"],
                "p90": player["simulation"]["p90"]
            })

        player_map = {
            player["playerId"]: player
            for player in players
        }

        slots = RULES["nba"][provider]["slots"]

        found = []
        result_status = None

        if len(players) < len(slots):
            print(
                f"{provider}: insufficient players"
            )

        attempts = (
            range(LINEUPS, 0, -1)
            if len(players) >= len(slots)
            else []
        )

        for count in attempts:
            result = optimize_multiple({
                "sport": "nba",
                "platform": provider,

                "slate": {
                    "id": str(report["slateId"]),
                    "sport": "nba",
                    "platform": provider,
                    "format": "classic",

                    "gameIds": list({
                        p["gameId"]
                        for p in players
                    })
                },

                "players": players,
                "lineupCount": count,
                "maxExposurePercent": 100,
                "minDifferentPlayers": 2,
                "timeLimitSeconds": 20
            })

            result_status = result.get("status")

            if (
                result.get("found")
                and len(result.get("lineups") or []) == count
            ):
                found = result["lineups"]
                break

        output = []
        signatures = set()

        for raw in found:
            checked = validate_result(
                raw,
                player_map,
                slots,
                cap
            )

            signature = tuple(sorted(
                str(p["playerId"])
                for p in checked["players"]
            ))

            ensure(
                signature not in signatures,
                "Repeated lineup"
            )

            signatures.add(signature)
            output.append(checked)

        output_file = DIRECTORY / (
            f"nba-{provider}-context-lineups-shadow.json"
        )

        output_file.write_text(
            json.dumps({
                "mode": "shadow",
                "platform": provider,
                "date": TARGET_DATE,
                "slateId": report["slateId"],
                "salaryCap": cap,
                "eligibleCandidates": len(players),
                "requestedLineups": LINEUPS,
                "generatedLineups": len(output),
                "solverStatus": result_status,

                "readyForPublication": False,

                "limitations": [
                    "Availability not confirmed",
                    "Team-level defense only",
                    "Historical teammate on/off",
                    "No lineup-level correlation",
                    "Formula not calibrated"
                ],

                "lineups": output
            }, indent=2),
            encoding="utf-8"
        )

        print(
            f"{provider.upper()} "
            f"slate {report['slateId']}: "
            f"{len(output)} SHADOW lineups "
            f"from {len(players)} candidates"
        )

        for index, lineup in enumerate(output, 1):
            print(
                f"LINEUP #{index} | "
                f"${lineup['salary']} | "
                f"{lineup['expectedFantasyPoints']} FP | "
                f"Starters: {lineup['startersByESPN']}"
            )

            for p in lineup["players"]:
                print(
                    f"  {p['rosterSlot']} "
                    f"{p['name']} "
                    f"${p['salary']} "
                    f"{p['projectedPoints']} FP"
                )

    print(
        "SHADOW ONLY | NO DATABASE WRITES"
    )


if __name__ == "__main__":
    main()
