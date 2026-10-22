
#!/usr/bin/env python3

"""
CashEdge NBA Fantasy: Contextual Lineups
SHADOW ONLY — No database writes.
"""

import json
import sys
from pathlib import Path

sys.path.insert(
    0,
    str(Path("fantasy-engine/optimizer").resolve())
)

from multi_solver import optimize_multiple
from solver import RULES, positions_of


DIRECTORY = Path("fantasy-slate-data")
TARGET_DATE = "2026-10-22"

BANNED_SALARY_MAX = 3500
LINEUPS = 5


def ensure(condition, message):
    if not condition:
        raise ValueError(message)


def selections_of(lineup):
    if isinstance(lineup, list):
        return lineup

    ensure(
        isinstance(lineup, dict),
        "Unexpected lineup format"
    )

    selections = lineup.get(
        "players",
        lineup.get("lineup")
    )

    ensure(
        isinstance(selections, list),
        "Missing lineup players"
    )

    return selections


def validate_result(
    lineup,
    player_map,
    slots,
    cap
):
    selections = selections_of(lineup)

    ensure(
        len(selections) == len(slots),
        "Incomplete lineup"
    )

    player_ids = [
        str(row["playerId"])
        for row in selections
    ]

    ensure(
        len(set(player_ids)) == len(player_ids),
        "Repeated player"
    )

    ensure(
        all(
            pid in player_map
            for pid in player_ids
        ),
        "Player outside slate"
    )

    salary = sum(
        player_map[pid]["salary"]
        for pid in player_ids
    )

    ensure(
        salary <= cap,
        "Salary cap exceeded"
    )

    ensure(
        all(
            player_map[pid]["salary"] >
            BANNED_SALARY_MAX
            for pid in player_ids
        ),
        "Forbidden salary"
    )

    assigned = [
        choice.get("slot")
        for choice in selections
    ]

    ensure(
        set(assigned) == set(slots)
        and len(assigned) == len(slots),
        "Incomplete or repeated roster slots"
    )

    # CORRECCION:
    # El optimizador y el validador usan
    # exactamente el mismo interprete
    # de posiciones.
    #
    # PG/SG -> PG, SG
    # SF/PF -> SF, PF
    #
    # No cambia las reglas de DraftKings.

    for choice in selections:
        slot = choice["slot"]
        pid = str(choice["playerId"])

        eligibility = positions_of(
            player_map[pid]
        )

        ensure(
            bool(
                eligibility.intersection(
                    slots[slot]
                )
            ),
            (
                "Invalid roster position: "
                f"{player_map[pid]['name']} | "
                f"slot={slot} | "
                f"positions={sorted(eligibility)}"
            )
        )

    return {
        "salary": salary,

        "expectedFantasyPoints": round(
            sum(
                player_map[pid]["projectedPoints"]
                for pid in player_ids
            ),
            2
        ),

        "startersByESPN": sum(
            player_map[pid]["depthRank"] == 1
            for pid in player_ids
        ),

        "strongReserves": sum(
            player_map[pid]["depthRank"] == 2
            for pid in player_ids
        ),

        "players": [
            {
                **player_map[
                    str(row["playerId"])
                ],
                "rosterSlot": row["slot"]
            }
            for row in selections
        ]
    }


def main():
    DIRECTORY.mkdir(
        parents=True,
        exist_ok=True
    )

    for provider in (
        "draftkings",
        "fanduel"
    ):
        source = DIRECTORY / (
            f"nba-{provider}-context-shadow.json"
        )

        if not source.exists():
            print(
                f"{provider}: "
                "no contextual slate; skipped"
            )
            continue

        report = json.loads(
            source.read_text(
                encoding="utf-8"
            )
        )

        ensure(
            report.get("mode") == "shadow"
            and report.get("date") == TARGET_DATE
            and report.get("platform") == provider,
            "Slate mismatch"
        )

        cap = RULES[
            "nba"
        ][provider]["salary_cap"]

        ensure(
            report.get("salaryCap") == cap,
            "Salary cap differs from optimizer"
        )

        players = []
        seen = set()

        normalized_multi_position = 0

        for raw in report.get(
            "players",
            []
        ):
            salary = raw.get("salary")

            if (
                not isinstance(salary, int)
                or isinstance(salary, bool)
                or salary <= BANNED_SALARY_MAX
                or raw.get("depthRank")
                not in (1, 2)
            ):
                continue

            if not (
                raw.get("gameId")
                and raw.get("teamId")
            ):
                continue

            if (
                raw.get("capturedBeforeTipoff")
                is not True
            ):
                continue

            pid = str(
                raw.get("playerId") or ""
            ).strip()

            if not pid:
                continue

            ensure(
                pid not in seen,
                f"Duplicate player ID: {pid}"
            )

            seen.add(pid)

            # Normalizamos antes de enviar
            # jugadores al optimizador.
            #
            # Utilizamos la funcion original
            # de solver.py, no otra formula.

            normalized_positions = sorted(
                positions_of(raw)
            )

            if not normalized_positions:
                continue

            if normalized_positions != list(
                raw.get("positions") or []
            ):
                normalized_multi_position += 1

            projected = float(
                raw.get("projectedPoints")
            )

            ensure(
                projected >= 0,
                f"Negative projection: {pid}"
            )

            players.append({
                "playerId": pid,

                "name":
                    raw.get("name") or pid,

                "teamId": str(
                    raw["teamId"]
                ),

                "gameId": str(
                    raw["gameId"]
                ),

                "salary": salary,

                "positions":
                    normalized_positions,

                "projectedPoints":
                    projected,

                "depthRank":
                    raw["depthRank"],

                "expectedMinutes":
                    raw.get("expectedMinutes"),

                "p10":
                    raw.get(
                        "simulation",
                        {}
                    ).get("p10"),

                "p90":
                    raw.get(
                        "simulation",
                        {}
                    ).get("p90")
            })

        player_map = {
            player["playerId"]: player
            for player in players
        }

        slots = RULES[
            "nba"
        ][provider]["slots"]

        output = []
        result_status = "NOT_RUN"
        attempts = []

        if len(players) < len(slots):
            result_status = (
                "NOT_ENOUGH_PLAYERS"
            )

            print(
                f"{provider}: "
                f"insufficient players "
                f"({len(players)})"
            )

        else:
            for count in range(
                LINEUPS,
                0,
                -1
            ):
                result = optimize_multiple({
                    "sport": "nba",

                    "platform": provider,

                    "slate": {
                        "id": str(
                            report["slateId"]
                        ),

                        "sport": "nba",

                        "platform": provider,

                        "format": "classic",

                        "gameIds": sorted({
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

                result_status = result.get(
                    "status",
                    "UNKNOWN"
                )

                attempts.append({
                    "lineups": count,
                    "status": result_status
                })

                if (
                    result.get("found")
                    and len(
                        result.get(
                            "lineups"
                        ) or []
                    ) == count
                ):
                    signatures = set()

                    for raw_lineup in (
                        result["lineups"]
                    ):
                        checked = validate_result(
                            raw_lineup,
                            player_map,
                            slots,
                            cap
                        )

                        signature = tuple(
                            sorted(
                                str(p["playerId"])
                                for p in checked[
                                    "players"
                                ]
                            )
                        )

                        ensure(
                            signature
                            not in signatures,
                            "Repeated lineup"
                        )

                        signatures.add(
                            signature
                        )

                        output.append(
                            checked
                        )

                    break

        destination = DIRECTORY / (
            f"nba-{provider}-"
            "context-lineups-shadow.json"
        )

        destination.write_text(
            json.dumps(
                {
                    "mode": "shadow",

                    "platform": provider,

                    "date": TARGET_DATE,

                    "slateId":
                        report["slateId"],

                    "salaryCap": cap,

                    "eligibleCandidates":
                        len(players),

                    "positionLabelsNormalized":
                        normalized_multi_position,

                    "requestedLineups":
                        LINEUPS,

                    "generatedLineups":
                        len(output),

                    "solverStatus":
                        result_status,

                    "attempts":
                        attempts,

                    "readyForPublication":
                        False,

                    "limitations": [
                        "Availability not confirmed",
                        "Team-level defense only",
                        "Historical teammate on/off",
                        "No lineup-level correlation",
                        "Formula not calibrated"
                    ],

                    "lineups":
                        output
                },
                ensure_ascii=False,
                indent=2
            ),
            encoding="utf-8"
        )

        print(
            f"{provider.upper()} | "
            f"Slate {report['slateId']} | "
            f"candidates {len(players)} | "
            f"normalized positions "
            f"{normalized_multi_position}"
        )

        print(
            f"GENERATED LINEUPS: "
            f"{len(output)} | "
            f"solver {result_status}"
        )

        for index, lineup in enumerate(
            output,
            1
        ):
            print(
                f"LINEUP #{index}: "
                f"salary ${lineup['salary']} | "
                f"{lineup['expectedFantasyPoints']} FP | "
                f"starters "
                f"{lineup['startersByESPN']}"
            )

            for p in lineup["players"]:
                print(
                    f"  {p['rosterSlot']}: "
                    f"{p['name']} | "
                    f"${p['salary']} | "
                    f"{p['projectedPoints']} FP"
                )

        print(
            "OUTPUT:",
            destination
        )

    print(
        "SHADOW ONLY | NO DATABASE WRITES"
    )


if __name__ == "__main__":
    main()
