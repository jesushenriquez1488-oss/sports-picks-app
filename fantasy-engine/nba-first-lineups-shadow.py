
#!/usr/bin/env python3

"""
CASHEDGE FANTASY NBA
FIRST FIVE LINEUPS - SHADOW

Usa:
- Slate real de BALLDONTLIE
- Historial NBA recuperado
- Proyecciones experimentales existentes
- Optimizador CP-SAT existente

NO modifica Supabase.
NO modifica Premium Picks.
NO modifica Player Props.
NO permite salarios <= $3,500.
NO inventa jugadores ni posiciones.
"""

import json
import sys
from datetime import datetime, date
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path("fantasy-slate-data")

INPUT = ROOT / "nba-draftkings-live-shadow.json"

OUTPUT = ROOT / "nba-draftkings-first-lineups-shadow.json"

sys.path.insert(
    0,
    str(Path("fantasy-engine/optimizer").resolve())
)

from multi_solver import optimize_multiple
from solver import RULES


PLATFORM = "draftkings"
SPORT = "nba"

REQUESTED_LINEUPS = 5

# Regla definitiva autorizada:
# $3,000 y $3,500 prohibidos.
MIN_ALLOWED_SALARY = 3501

TARGET_DATE = "2026-10-22"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def load_report():
    require(
        INPUT.exists(),
        f"Missing slate report: {INPUT}"
    )

    with INPUT.open(
        "r",
        encoding="utf-8"
    ) as handle:
        report = json.load(handle)

    require(
        report.get("mode") == "shadow",
        "SHADOW mode required"
    )

    require(
        report.get("sport") == SPORT,
        "Wrong sport"
    )

    require(
        report.get("platform") == PLATFORM,
        "Wrong platform"
    )

    require(
        report.get("targetDate") == TARGET_DATE,
        "Wrong target date"
    )

    require(
        report.get("slateId"),
        "Missing real slate ID"
    )

    require(
        report.get("model") ==
        "HISTORICAL_BOOTSTRAP_BASELINE",
        "Unexpected projection source"
    )

    require(
        isinstance(report.get("players"), list),
        "Missing players"
    )

    return report


def prepare_players(report):
    """
    Nunca busca jugadores fuera del slate.

    Los jugadores ya fueron cruzados con
    el historial y el Depth Chart.

    Se vuelven a aplicar los bloqueos
    por seguridad antes de optimizar.
    """

    eligible = []

    seen = set()

    exclusions = {}

    def reject(reason):
        exclusions[reason] = (
            exclusions.get(reason, 0) + 1
        )

    for row in report["players"]:
        player_id = str(
            row.get("playerId") or ""
        ).strip()

        if not player_id:
            reject("MISSING_PLAYER_ID")
            continue

        if player_id in seen:
            reject("DUPLICATE_PLAYER")
            continue

        salary = number(
            row.get("salary")
        )

        if (
            salary is None or
            salary < MIN_ALLOWED_SALARY
        ):
            reject("BANNED_SALARY")
            continue

        rank = row.get("depthRank")

        if rank not in (1, 2):
            reject("OUTSIDE_PRIMARY_ROTATION")
            continue

        positions = row.get("positions")

        if (
            not isinstance(positions, list) or
            not positions
        ):
            reject("NO_POSITION")
            continue

        positions = sorted({
            str(position).upper().strip()
            for position in positions
            if str(position).strip()
        })

        positions = [
            position
            for position in positions
            if position in {
                "PG", "SG", "SF", "PF", "C"
            }
        ]

        if not positions:
            reject("INVALID_POSITION")
            continue

        projected = number(
            row.get("projectedPoints")
        )

        minutes = number(
            row.get("expectedMinutes")
        )

        if (
            projected is None or
            projected <= 0 or
            minutes is None or
            minutes <= 0
        ):
            reject("MISSING_PROJECTION")
            continue

        if not row.get("gameId"):
            reject("NO_REAL_GAME_ID")
            continue

        if not row.get("teamId"):
            reject("NO_TEAM_ID")
            continue

        player = {
            "playerId": player_id,
            "name": str(
                row.get("name") or player_id
            ),
            "teamId": str(
                row["teamId"]
            ),
            "gameId": str(
                row["gameId"]
            ),
            "positions": positions,
            "salary": int(salary),
            "projectedPoints": round(
                projected,
                2
            ),
            "expectedMinutes": round(
                minutes,
                2
            ),
            "depthRank": rank
        }

        eligible.append(player)
        seen.add(player_id)

    return eligible, exclusions


def extract_lineup(item):
    if isinstance(item, list):
        return item

    if isinstance(item, dict):
        if isinstance(
            item.get("lineup"),
            list
        ):
            return item["lineup"]

        if isinstance(
            item.get("players"),
            list
        ):
            return item["players"]

    raise ValueError(
        "Unknown CP-SAT lineup format"
    )


def validate_lineups(
    lineups,
    available,
    salary_cap
):
    """
    Verifica nuevamente cada alineacion
    devuelta por el optimizador.

    La verificacion nunca modifica una
    alineacion para hacerla pasar.
    """

    valid_players = {
        row["playerId"]: row
        for row in available
    }

    expected_size = len(
        RULES[SPORT][PLATFORM]["slots"]
    )

    checked = []

    signatures = set()

    for index, item in enumerate(
        lineups,
        start=1
    ):
        lineup = extract_lineup(item)

        require(
            len(lineup) == expected_size,
            f"Lineup {index}: wrong roster size"
        )

        ids = [
            str(player.get("playerId"))
            for player in lineup
        ]

        require(
            len(ids) == len(set(ids)),
            f"Lineup {index}: duplicate player"
        )

        require(
            all(pid in valid_players for pid in ids),
            f"Lineup {index}: unknown player"
        )

        salary = sum(
            valid_players[pid]["salary"]
            for pid in ids
        )

        require(
            salary <= salary_cap,
            f"Lineup {index}: over salary cap"
        )

        require(
            all(
                valid_players[pid]["salary"] >
                3500
                for pid in ids
            ),
            f"Lineup {index}: banned salary"
        )

        signature = tuple(sorted(ids))

        require(
            signature not in signatures,
            f"Lineup {index}: repeated lineup"
        )

        signatures.add(signature)

        projected = sum(
            valid_players[pid][
                "projectedPoints"
            ]
            for pid in ids
        )

        count_starters = sum(
            valid_players[pid]["depthRank"] == 1
            for pid in ids
        )

        details = []

        for selection in lineup:
            pid = str(
                selection["playerId"]
            )

            player = valid_players[pid]

            details.append({
                **player,
                "assignedSlot": selection.get(
                    "slot"
                )
            })

        checked.append({
            "number": index,
            "salary": salary,
            "salaryRemaining":
                salary_cap - salary,
            "projectedPoints": round(
                projected,
                2
            ),
            "firstListed": count_starters,
            "strongReserves":
                len(ids) - count_starters,
            "players": details
        })

    return checked


def main():
    report = load_report()

    salary_cap = number(
        report.get("salaryCap")
    )

    require(
        salary_cap is not None and
        salary_cap > 0,
        "Missing real salary cap"
    )

    configured_cap = RULES[
        SPORT
    ][PLATFORM]["salary_cap"]

    require(
        salary_cap == configured_cap,
        "BALLDONTLIE salary cap differs "
        "from the optimizer configuration"
    )

    players, exclusions = prepare_players(
        report
    )

    games = sorted({
        row["gameId"]
        for row in players
    })

    print(
        "===== CASHEDGE NBA FIRST FIVE LINEUPS ====="
    )

    print(
        "Slate:",
        report["slateId"]
    )

    print(
        "Date:",
        TARGET_DATE
    )

    print(
        "Real salary cap:",
        int(salary_cap)
    )

    print(
        "Usable projected players:",
        len(players)
    )

    print(
        "Available games:",
        len(games)
    )

    print(
        "Excluded:",
        json.dumps(
            exclusions,
            ensure_ascii=False
        )
    )

    config = {
        "id": str(
            report["slateId"]
        ),
        "sport": SPORT,
        "platform": PLATFORM,
        "format": "classic",
        "gameIds": games
    }

    found = None
    attempts = []

    # Pedimos cinco distintas.
    # Si no hay cinco, buscamos cuatro,
    # tres, dos o una.
    #
    # No agregamos jugadores falsos.
    # No eliminamos prohibiciones.

    for count in range(
        REQUESTED_LINEUPS,
        0,
        -1
    ):
        payload = {
            "sport": SPORT,
            "platform": PLATFORM,
            "slate": config,
            "players": players,
            "lineupCount": count,
            "maxExposurePercent": 100,
            "minDifferentPlayers": 2,
            "timeLimitSeconds": 20
        }

        result = optimize_multiple(
            payload
        )

        attempts.append({
            "requested": count,
            "found": bool(
                result.get("found")
            ),
            "status": result.get(
                "status"
            )
        })

        if (
            result.get("found") and
            isinstance(
                result.get("lineups"),
                list
            ) and
            len(result["lineups"]) == count
        ):
            found = result
            break

    if found:
        lineups = validate_lineups(
            found["lineups"],
            players,
            int(salary_cap)
        )
    else:
        lineups = []

    output = {
        "module": "fantasy_nba",
        "mode": "shadow",
        "date": TARGET_DATE,
        "platform": PLATFORM,
        "slateId": str(
            report["slateId"]
        ),
        "salaryCap": int(salary_cap),
        "requestedLineups":
            REQUESTED_LINEUPS,
        "generatedLineups":
            len(lineups),
        "eligiblePlayers":
            len(players),
        "attempts": attempts,
        "exclusions": exclusions,
        "projectionModel":
            "HISTORICAL_BOOTSTRAP_BASELINE",
        "opponentAdjusted": False,
        "injuriesAdjusted": False,
        "gameDayAvailabilityVerified": False,
        "readyForPublication": False,
        "lineups": lineups
    }

    ROOT.mkdir(
        parents=True,
        exist_ok=True
    )

    with OUTPUT.open(
        "w",
        encoding="utf-8"
    ) as handle:
        json.dump(
            output,
            handle,
            ensure_ascii=False,
            indent=2
        )

    print(
        "LINEUPS GENERATED:",
        len(lineups)
    )

    for lineup in lineups:
        print()
        print(
            f"LINEUP #{lineup['number']}"
        )

        print(
            "Salary:",
            lineup["salary"]
        )

        print(
            "Projected:",
            lineup["projectedPoints"]
        )

        print(
            "First-listed:",
            lineup["firstListed"]
        )

        print(
            "Strong reserves:",
            lineup["strongReserves"]
        )

        for player in lineup["players"]:
            print(
                player["assignedSlot"],
                "|",
                player["name"],
                "|",
                "$" + str(player["salary"]),
                "|",
                str(
                    player["projectedPoints"]
                ) + " FP"
            )

    print()
    print("OUTPUT:", OUTPUT)

    print(
        "SHADOW ONLY | NO DATABASE WRITES"
    )


if __name__ == "__main__":
    main()
