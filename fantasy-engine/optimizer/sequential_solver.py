
"""
CASHEDGE FANTASY EDGE
SEQUENTIAL MULTI-LINEUP OPTIMIZER

NBA / NFL - DraftKings / FanDuel
OR-Tools CP-SAT

Cada alineacion se optimiza por separado.
Respeta exposicion y diversidad acumuladas.

SHADOW ONLY - Sin API ni escrituras.
"""

import json
import sys
import math
from decimal import Decimal, InvalidOperation
from collections import Counter

from ortools.sat.python import cp_model

from solver import RULES, SCORE_SCALE
from solver import score_units, positions_of


def ident(value):
    return "" if value is None else str(value).strip()


def solve_sequential(payload):
    if not isinstance(payload, dict):
        raise ValueError("JSON invalido")

    sport = str(payload.get("sport", "")).lower()
    platform = str(payload.get("platform", "")).lower()

    if sport not in RULES or platform not in RULES[sport]:
        raise ValueError("Deporte o plataforma invalida")

    config = RULES[sport][platform]
    slots = config["slots"]
    salary_cap = config["salary_cap"]
    roster_size = len(slots)

    count = payload.get("lineupCount", 3)
    changes = payload.get("minDifferentPlayers", 2)

    if (
        type(count) is not int or
        type(changes) is not int or
        not 1 <= count <= 10 or
        not 1 <= changes <= roster_size
    ):
        raise ValueError("Cantidad o diversidad invalida")

    try:
        exposure = Decimal(
            str(payload.get("maxExposurePercent", 100))
        )
        seconds = float(
            payload.get("timeLimitSeconds", 3)
        )
    except (ValueError, TypeError, InvalidOperation):
        raise ValueError("Parametros invalidos")

    if not exposure.is_finite() or not 0 < exposure <= 100:
        raise ValueError("Exposicion invalida")

    if not math.isfinite(seconds) or not 0.1 <= seconds <= 30:
        raise ValueError("Tiempo invalido")

    max_appearances = int(
        exposure * Decimal(count) / 100
    )

    if max_appearances < 1:
        raise ValueError("Exposicion demasiado baja")

    slate = payload.get("slate")

    if (
        not isinstance(slate, dict) or
        not slate.get("id") or
        slate.get("sport") != sport or
        slate.get("platform") != platform or
        slate.get("format") != "classic"
    ):
        raise ValueError("Slate Classic invalido")

    game_ids = slate.get("gameIds")

    if not isinstance(game_ids, list) or not game_ids:
        raise ValueError("Partidos faltantes")

    allowed_games = set(map(ident, game_ids))

    if "" in allowed_games:
        raise ValueError("Game ID invalido")

    raw_players = payload.get("players")

    if not isinstance(raw_players, list) or len(raw_players) > 1000:
        raise ValueError("Jugadores invalidos")

    locked = payload.get("locked", [])
    excluded = payload.get("excluded", [])

    if not isinstance(locked, list) or not isinstance(excluded, list):
        raise ValueError("Bloqueos invalidos")

    locked_ids = set(map(ident, locked))
    excluded_ids = set(map(ident, excluded))

    if (
        "" in locked_ids or
        "" in excluded_ids or
        locked_ids & excluded_ids or
        len(locked_ids) > roster_size
    ):
        raise ValueError("Bloqueos incompatibles")

    # Los locks se aplican a todas las alineaciones.
    if locked_ids and max_appearances < count:
        raise ValueError(
            "Lock global incompatible con exposicion maxima"
        )

    pool = {}

    for raw in raw_players:
        if not isinstance(raw, dict):
            continue

        pid = ident(raw.get("playerId", raw.get("id")))

        if not pid or pid in excluded_ids:
            continue

        if (
            raw.get("disabled") is True or
            raw.get("status") == "out_injury" or
            raw.get("injuryStatus") == "out"
        ):
            continue

        try:
            salary = raw.get("salary")

            if (
                type(salary) is not int or
                not 0 < salary <= salary_cap
            ):
                continue

            points = score_units(
                raw.get("projectedPoints")
            )
        except (ValueError, TypeError, ArithmeticError):
            continue

        game_id = ident(raw.get("gameId"))

        if game_id not in allowed_games:
            continue

        positions = sorted(positions_of(raw))

        if not positions:
            continue

        candidate = {
            "playerId": pid,
            "name": raw.get("name"),
            "teamId": ident(raw.get("teamId")),
            "gameId": game_id,
            "salary": salary,
            "scoreUnits": points,
            "positions": positions,
        }

        if pid in pool and pool[pid] != candidate:
            raise ValueError("Jugador contradictorio: " + pid)

        pool[pid] = candidate

    if not locked_ids.issubset(pool):
        raise ValueError("Jugador bloqueado no disponible")

    appearances = Counter()
    prior_lineups = []
    results = []
    statuses = []
    total_time = 0.0

    for index in range(count):
        model = cp_model.CpModel()

        # Excluir jugadores que agotaron su exposicion.
        available = {
            pid: player
            for pid, player in pool.items()
            if appearances[pid] < max_appearances
        }

        if len(available) < roster_size:
            break

        assignments = {}
        selected = {}

        for pid, player in available.items():
            choices = []

            for slot_id, eligible in slots.items():
                if set(player["positions"]) & set(eligible):
                    var = model.NewBoolVar(
                        f"x_{len(assignments)}"
                    )
                    assignments[pid, slot_id] = var
                    choices.append(var)

            if choices:
                selected[pid] = model.NewBoolVar(
                    f"y_{len(selected)}"
                )
                model.Add(
                    sum(choices) == selected[pid]
                )

        # Cada slot se ocupa exactamente una vez.
        possible = True

        for slot_id in slots:
            choices = [
                var
                for (pid, sid), var in assignments.items()
                if sid == slot_id
            ]

            if not choices:
                possible = False
                break

            model.Add(sum(choices) == 1)

        if not possible:
            break

        # Salario.
        model.Add(
            sum(
                available[pid]["salary"] * var
                for pid, var in selected.items()
            ) <= salary_cap
        )

        # Bloqueos globales.
        for pid in locked_ids:
            if pid not in selected:
                possible = False
                break
            model.Add(selected[pid] == 1)

        if not possible:
            break

        # Cada nueva alineacion debe diferir
        # de TODAS las alineaciones anteriores.
        for prior in prior_lineups:
            shared = [
                selected[pid]
                for pid in prior
                if pid in selected
            ]

            model.Add(
                sum(shared) <= roster_size - changes
            )

        model.Maximize(
            sum(
                available[pid]["scoreUnits"] * var
                for pid, var in selected.items()
            )
        )

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = seconds
        solver.parameters.num_search_workers = 4

        code = solver.Solve(model)
        status = solver.StatusName(code)
        statuses.append(status)

        total_time += solver.WallTime()

        if code not in (
            cp_model.OPTIMAL,
            cp_model.FEASIBLE
        ):
            break

        lineup = []

        for (pid, slot_id), var in assignments.items():
            if solver.Value(var) != 1:
                continue

            player = available[pid]

            lineup.append({
                "slot": slot_id,
                "playerId": pid,
                "name": player["name"],
                "teamId": player["teamId"],
                "gameId": player["gameId"],
                "salary": player["salary"],
                "positions": player["positions"],
                "projectedPoints":
                    player["scoreUnits"] / SCORE_SCALE,
            })

        lineup.sort(
            key=lambda row: list(slots).index(
                row["slot"]
            )
        )

        chosen = {
            row["playerId"]
            for row in lineup
        }

        salary_total = sum(
            row["salary"] for row in lineup
        )

        if (
            len(lineup) != roster_size or
            len(chosen) != roster_size or
            salary_total > salary_cap or
            not locked_ids.issubset(chosen) or
            any(
                len(chosen & prior) >
                roster_size - changes
                for prior in prior_lineups
            )
        ):
            raise RuntimeError(
                "Alineacion generada no valida"
            )

        score = sum(
            available[pid]["scoreUnits"]
            for pid in chosen
        )

        for pid in chosen:
            appearances[pid] += 1

        prior_lineups.append(chosen)

        results.append({
            "number": index + 1,
            "status": status,
            "optimalityGuaranteed":
                code == cp_model.OPTIMAL,
            "projectedPoints": score / SCORE_SCALE,
            "salary": salary_total,
            "remainingSalary":
                salary_cap - salary_total,
            "players": lineup,
        })

    exposure_results = [
        {
            "playerId": pid,
            "appearances": times,
            "percentage": round(
                times * 100 / count, 2
            ),
        }
        for pid, times in appearances.items()
        if times > 0
    ]

    exposure_results.sort(
        key=lambda item: (
            -item["appearances"],
            item["playerId"]
        )
    )

    complete = len(results) == count

    return {
        "found": complete,
        "mode": "shadow",
        "solver": "ortools-cp-sat-sequential",
        "sport": sport,
        "platform": platform,
        "status": (
            "COMPLETE" if complete else "PARTIAL"
        ),
        "requestedLineups": count,
        "generatedLineups": len(results),
        "maxExposurePercent": float(exposure),
        "maxAppearances": max_appearances,
        "minDifferentPlayers": changes,
        "allStepOptimal": (
            complete and
            all(
                row["optimalityGuaranteed"]
                for row in results
            )
        ),
        # Una secuencia de optimos individuales
        # NO demuestra el optimo global.
        "globalOptimalityGuaranteed": False,
        "totalProjectedPoints": sum(
            row["projectedPoints"]
            for row in results
        ),
        "wallTimeSeconds": round(total_time, 4),
        "stepStatuses": statuses,
        "contestVerified": False,
        "readyForPublication": False,
        "lineups": results,
        "playerExposure": exposure_results,
    }


if __name__ == "__main__":
    try:
        payload = json.load(sys.stdin)
        print(json.dumps(solve_sequential(payload)))
    except Exception as error:
        print(json.dumps({
            "found": False,
            "status": "ERROR",
            "error": str(error),
            "readyForPublication": False,
        }))
        sys.exit(1)
