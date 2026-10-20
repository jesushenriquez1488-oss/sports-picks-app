
"""
CASHEDGE FANTASY EDGE
MULTI-LINEUP OPTIMIZER — OR-TOOLS CP-SAT

NBA / NFL — DraftKings / FanDuel

Optimiza todas las alineaciones conjuntamente.
Controla exposicion, bloqueos y diversidad.

SHADOW ONLY.
Sin APIs, escrituras ni cambios en produccion.
"""

import json
import sys
import math
import re
from decimal import Decimal, InvalidOperation

from ortools.sat.python import cp_model

from solver import RULES, SCORE_SCALE, score_units, positions_of


def identifier(value):
    if value is None:
        return ""
    return str(value).strip()


def integer(value, name, low, high):
    if isinstance(value, bool):
        raise ValueError(name + " invalido")

    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(name + " invalido")

    if str(value) != str(number):
        raise ValueError(name + " debe ser entero")

    if not low <= number <= high:
        raise ValueError(name + " fuera de rango")

    return number


def optimize_multiple(payload):
    if not isinstance(payload, dict):
        raise ValueError("JSON invalido")

    sport = str(
        payload.get("sport") or ""
    ).lower()

    platform = str(
        payload.get("platform") or ""
    ).lower()

    if sport not in RULES or platform not in RULES[sport]:
        raise ValueError("Deporte o plataforma invalida")

    rules = RULES[sport][platform]
    slots = rules["slots"]
    salary_cap = rules["salary_cap"]

    count = integer(
        payload.get("lineupCount", 3),
        "lineupCount", 1, 10
    )

    min_changes = integer(
        payload.get("minDifferentPlayers", 1),
        "minDifferentPlayers",
        1, len(slots)
    )

    try:
        exposure = Decimal(
            str(payload.get("maxExposurePercent", 100))
        )
        time_limit = float(
            payload.get("timeLimitSeconds", 30)
        )
    except (ValueError, TypeError, InvalidOperation):
        raise ValueError("Parametros numericos invalidos")

    if not exposure.is_finite() or not 0 < exposure <= 100:
        raise ValueError("Exposicion debe estar entre 0 y 100")

    if not math.isfinite(time_limit) or not 0.1 <= time_limit <= 120:
        raise ValueError("Limite de tiempo invalido")

    # Redondeo conservador: 3 lineups al 50%
    # permiten como maximo 1 aparicion por jugador.
    max_appearances = int(
        exposure * Decimal(count) / Decimal(100)
    )

    if max_appearances < 1:
        raise ValueError(
            "Exposicion demasiado baja para lineupCount"
        )

    slate = payload.get("slate")

    if (
        not isinstance(slate, dict)
        or not slate.get("id")
        or slate.get("sport") != sport
        or slate.get("platform") != platform
        or slate.get("format") != "classic"
    ):
        raise ValueError("Slate Classic invalido")

    game_ids = slate.get("gameIds")

    if not isinstance(game_ids, list) or not game_ids:
        raise ValueError("Partidos del slate faltantes")

    allowed_games = set(map(identifier, game_ids))

    if "" in allowed_games:
        raise ValueError("Game ID invalido")

    raw_players = payload.get("players")

    if not isinstance(raw_players, list) or len(raw_players) > 1000:
        raise ValueError("Lista de jugadores invalida")

    locked = payload.get("locked", [])
    excluded = payload.get("excluded", [])

    if not isinstance(locked, list) or not isinstance(excluded, list):
        raise ValueError("Bloqueos o exclusiones invalidos")

    locked_ids = set(map(identifier, locked))
    excluded_ids = set(map(identifier, excluded))

    if (
        "" in locked_ids
        or "" in excluded_ids
        or locked_ids & excluded_ids
    ):
        raise ValueError("Bloqueos y exclusiones incompatibles")

    if len(locked_ids) > len(slots):
        raise ValueError("Demasiados jugadores bloqueados")

    # Los locks se aplican a TODAS las alineaciones.
    if locked_ids and max_appearances < count:
        raise ValueError(
            "Lock en todas las alineaciones incompatible "
            "con la exposicion maxima"
        )

    pool = {}

    for raw in raw_players:
        if not isinstance(raw, dict):
            continue

        pid = identifier(
            raw.get("playerId", raw.get("id"))
        )

        if not pid or pid in excluded_ids:
            continue

        if (
            raw.get("disabled") is True
            or raw.get("status") == "out_injury"
            or raw.get("injuryStatus") == "out"
        ):
            continue

        try:
            salary_raw = raw.get("salary")
            salary = integer(
                salary_raw, "salary", 1, salary_cap
            )
            points = score_units(
                raw.get("projectedPoints")
            )
        except (ValueError, TypeError, ArithmeticError):
            continue

        game_id = identifier(raw.get("gameId"))
        positions = sorted(positions_of(raw))

        if game_id not in allowed_games or not positions:
            continue

        candidate = {
            "playerId": pid,
            "name": raw.get("name"),
            "teamId": identifier(raw.get("teamId")),
            "gameId": game_id,
            "positions": positions,
            "salary": salary,
            "scoreUnits": points,
        }

        if pid in pool:
            if pool[pid] != candidate:
                raise ValueError(
                    "Jugador duplicado contradictorio: " + pid
                )
            continue

        pool[pid] = candidate

    if not locked_ids.issubset(pool):
        raise ValueError("Jugador bloqueado no disponible")

    def no_solution(status, reason, wall_time=0):
        return {
            "found": False,
            "mode": "shadow",
            "solver": "ortools-cp-sat-multi",
            "sport": sport,
            "platform": platform,
            "status": status,
            "reason": reason,
            "optimalityGuaranteed": status == "INFEASIBLE",
            "contestVerified": False,
            "readyForPublication": False,
            "lineups": [],
            "wallTimeSeconds": wall_time,
        }

    if len(pool) < len(slots):
        return no_solution(
            "INFEASIBLE", "not_enough_players"
        )

    model = cp_model.CpModel()

    # x: jugador asignado a slot en alineacion
    # y: jugador seleccionado en alineacion

    x = {}
    y = {}

    for k in range(count):
        for pid, player in pool.items():
            eligible_slots = [
                slot_id
                for slot_id, allowed in slots.items()
                if set(player["positions"]) & set(allowed)
            ]

            if not eligible_slots:
                continue

            y[k, pid] = model.NewBoolVar(
                f"selected_{k}_{len(y)}"
            )

            choices = []

            for slot_id in eligible_slots:
                var = model.NewBoolVar(
                    f"assign_{k}_{len(x)}"
                )

                x[k, pid, slot_id] = var
                choices.append(var)

            # Un jugador ocupa exactamente un slot
            # cuando esta seleccionado.
            model.Add(
                sum(choices) == y[k, pid]
            )

    # Reglas independientes por alineacion.

    for k in range(count):

        for slot_id in slots:
            options = [
                var
                for (lineup, pid, slot), var in x.items()
                if lineup == k and slot == slot_id
            ]

            if not options:
                return no_solution(
                    "INFEASIBLE",
                    "missing_eligible_position"
                )

            model.Add(sum(options) == 1)

        model.Add(
            sum(
                pool[pid]["salary"] * var
                for (lineup, pid), var in y.items()
                if lineup == k
            ) <= salary_cap
        )

        for pid in locked_ids:
            if (k, pid) not in y:
                return no_solution(
                    "INFEASIBLE",
                    "locked_player_ineligible"
                )

            model.Add(y[k, pid] == 1)

    # SIMETRIA: ordenar alineaciones por puntuacion.
    # Permutar los numeros de alineacion no cambia
    # la solucion ni el objetivo matematico.
    # Esta restriccion conserva el optimo global.

    lineup_scores = []

    for k in range(count):
        score_expression = sum(
            pool[pid]["scoreUnits"] * var
            for (lineup, pid), var in y.items()
            if lineup == k
        )

        lineup_scores.append(score_expression)

    for k in range(count - 1):
        model.Add(
            lineup_scores[k] >= lineup_scores[k + 1]
        )

    # Exposicion maxima entre todas las alineaciones.

    for pid in pool:
        occurrences = [
            y[k, pid]
            for k in range(count)
            if (k, pid) in y
        ]

        if occurrences:
            model.Add(
                sum(occurrences) <= max_appearances
            )

    # Diversificacion:
    # cada par debe diferir al menos
    # en minDifferentPlayers jugadores.

    if count > 1:
        for a in range(count):
            for b in range(a + 1, count):
                shared = []

                for pid in pool:
                    if (a, pid) not in y or (b, pid) not in y:
                        continue

                    both = model.NewBoolVar(
                        f"shared_{a}_{b}_{len(shared)}"
                    )

                    model.Add(
                        both <= y[a, pid]
                    )

                    model.Add(
                        both <= y[b, pid]
                    )

                    model.Add(
                        both >= y[a, pid] + y[b, pid] - 1
                    )

                    shared.append(both)

                model.Add(
                    sum(shared) <=
                    len(slots) - min_changes
                )

    # Maximizar puntos proyectados conjuntos.
    # No se maximiza solo la primera alineacion.

    model.Maximize(
        sum(
            pool[pid]["scoreUnits"] * var
            for (k, pid), var in y.items()
        )
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers = 4

    code = solver.Solve(model)
    status = solver.StatusName(code)

    elapsed = round(solver.WallTime(), 4)

    if code not in (
        cp_model.OPTIMAL,
        cp_model.FEASIBLE
    ):
        return no_solution(
            status,
            "no_valid_portfolio_or_proof",
            elapsed
        )

    lineups = []

    for k in range(count):
        lineup = []

        for (lineup_id, pid, slot_id), var in x.items():
            if lineup_id != k or solver.Value(var) != 1:
                continue

            player = pool[pid]

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

        order = list(slots)

        lineup.sort(
            key=lambda item: order.index(item["slot"])
        )

        if (
            len(lineup) != len(slots)
            or len({p["playerId"] for p in lineup}) != len(slots)
        ):
            raise RuntimeError("Alineacion interna invalida")

        salary = sum(p["salary"] for p in lineup)

        score_units_total = sum(
            pool[p["playerId"]]["scoreUnits"]
            for p in lineup
        )

        if salary > salary_cap:
            raise RuntimeError("Presupuesto interno excedido")

        lineups.append({
            "number": k + 1,
            "projectedPoints":
                score_units_total / SCORE_SCALE,
            "salary": salary,
            "remainingSalary": salary_cap - salary,
            "players": lineup,
        })

    # La numeracion final se ordena por puntos.
    lineups.sort(
        key=lambda item: (
            -item["projectedPoints"],
            item["salary"]
        )
    )

    for i, lineup in enumerate(lineups):
        lineup["number"] = i + 1

    # Exposiciones realizadas.

    appearance_counts = {}

    for lineup in lineups:
        for player in lineup["players"]:
            pid = player["playerId"]
            appearance_counts[pid] = (
                appearance_counts.get(pid, 0) + 1
            )

    actual_exposure = [
        {
            "playerId": pid,
            "appearances": occurrences,
            "percentage": round(
                100 * occurrences / count, 2
            ),
        }
        for pid, occurrences in appearance_counts.items()
    ]

    actual_exposure.sort(
        key=lambda row: (
            -row["appearances"],
            row["playerId"]
        )
    )

    total_units = sum(
        sum(
            pool[player["playerId"]]["scoreUnits"]
            for player in lineup["players"]
        )
        for lineup in lineups
    )

    return {
        "found": True,
        "mode": "shadow",
        "solver": "ortools-cp-sat-multi",
        "sport": sport,
        "platform": platform,
        "status": status,
        "lineupCount": count,
        "optimalityGuaranteed":
            code == cp_model.OPTIMAL,
        "contestVerified": False,
        "readyForPublication": False,
        "maxExposurePercent": float(exposure),
        "maxAppearances": max_appearances,
        "minDifferentPlayers": min_changes,
        "totalProjectedPoints":
            total_units / SCORE_SCALE,
        "wallTimeSeconds": elapsed,
        "lineups": lineups,
        "playerExposure": actual_exposure,
    }


if __name__ == "__main__":
    try:
        payload = json.load(sys.stdin)
        result = optimize_multiple(payload)
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({
            "found": False,
            "status": "ERROR",
            "error": str(error),
            "readyForPublication": False,
        }))
        sys.exit(1)
