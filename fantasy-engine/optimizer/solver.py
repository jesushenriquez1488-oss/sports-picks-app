
"""
CASHEDGE FANTASY EDGE
EXACT DFS OPTIMIZER — OR-TOOLS CP-SAT

NBA / NFL
DraftKings / FanDuel

Solo calculos.
No consulta APIs.
No escribe en Supabase.
No modifica Premium Picks ni Player Props.
"""

import json
import sys
import re
from decimal import Decimal, ROUND_HALF_UP

from ortools.sat.python import cp_model


RULES = {
    "nba": {
        "draftkings": {
            "salary_cap": 50000,
            "slots": {
                "PG": ["PG"],
                "SG": ["SG"],
                "SF": ["SF"],
                "PF": ["PF"],
                "C": ["C"],
                "G": ["PG", "SG"],
                "F": ["SF", "PF"],
                "UTIL": ["PG", "SG", "SF", "PF", "C"],
            },
        },
        "fanduel": {
            "salary_cap": 60000,
            "slots": {
                "PG1": ["PG"],
                "PG2": ["PG"],
                "SG1": ["SG"],
                "SG2": ["SG"],
                "SF1": ["SF"],
                "SF2": ["SF"],
                "PF1": ["PF"],
                "PF2": ["PF"],
                "C": ["C"],
            },
        },
    },
    "nfl": {
        "draftkings": {
            "salary_cap": 50000,
            "slots": {
                "QB": ["QB"],
                "RB1": ["RB"],
                "RB2": ["RB"],
                "WR1": ["WR"],
                "WR2": ["WR"],
                "WR3": ["WR"],
                "TE": ["TE"],
                "FLEX": ["RB", "WR", "TE"],
                "DST": ["DST"],
            },
        },
        "fanduel": {
            "salary_cap": 60000,
            "slots": {
                "QB": ["QB"],
                "RB1": ["RB"],
                "RB2": ["RB"],
                "WR1": ["WR"],
                "WR2": ["WR"],
                "WR3": ["WR"],
                "TE": ["TE"],
                "FLEX": ["RB", "WR", "TE"],
                "DEF": ["DST"],
            },
        },
    },
}

SCORE_SCALE = 10000


def normalized_id(value):
    if value is None:
        return ""
    return str(value).strip()


def positions_of(player):
    raw = player.get("positions")

    if not isinstance(raw, list):
        raw = [player.get("position", "")]

    positions = set()

    for item in raw:
        for position in re.split(r"[/,]", str(item).upper()):
            position = position.strip()

            if position in ("DEF", "D"):
                position = "DST"

            if position:
                positions.add(position)

    return positions


def score_units(value):
    number = Decimal(str(value))

    if not number.is_finite() or number < 0:
        raise ValueError("Proyeccion invalida")

    return int(
        (number * SCORE_SCALE).quantize(
            Decimal("1"),
            rounding=ROUND_HALF_UP,
        )
    )


def empty_result(status, reason, sport, platform):
    return {
        "found": False,
        "status": status,
        "reason": reason,
        "sport": sport,
        "platform": platform,
        "mode": "shadow",
        "optimalityGuaranteed": status == "INFEASIBLE",
        "contestVerified": False,
        "readyForPublication": False,
        "lineup": [],
    }


def optimize(payload):
    if not isinstance(payload, dict):
        raise ValueError("Entrada JSON invalida")

    sport = str(
        payload.get("sport") or ""
    ).lower()

    platform = str(
        payload.get("platform") or ""
    ).lower()

    if (
        sport not in RULES
        or platform not in RULES[sport]
    ):
        raise ValueError("Deporte o plataforma invalida")

    config = RULES[sport][platform]

    slate = payload.get("slate")

    if not isinstance(slate, dict):
        raise ValueError("Slate obligatorio")

    if (
        not slate.get("id")
        or slate.get("sport") != sport
        or slate.get("platform") != platform
        or slate.get("format") != "classic"
    ):
        raise ValueError("Slate Classic invalido")

    game_ids = slate.get("gameIds")

    if not isinstance(game_ids, list) or not game_ids:
        raise ValueError("Partidos del slate faltantes")

    allowed_games = set(map(normalized_id, game_ids))

    if "" in allowed_games:
        raise ValueError("Game ID invalido")

    players = payload.get("players")

    if not isinstance(players, list):
        raise ValueError("Jugadores invalidos")

    if len(players) > 1000:
        raise ValueError("Demasiados jugadores")

    locked = payload.get("locked", [])
    excluded = payload.get("excluded", [])

    if not isinstance(locked, list) or not isinstance(excluded, list):
        raise ValueError("Bloqueos invalidos")

    locked_ids = set(map(normalized_id, locked))
    excluded_ids = set(map(normalized_id, excluded))

    if (
        "" in locked_ids
        or "" in excluded_ids
        or locked_ids & excluded_ids
    ):
        raise ValueError("Bloqueos y exclusiones incompatibles")

    slots = config["slots"]

    if len(locked_ids) > len(slots):
        raise ValueError("Demasiados jugadores bloqueados")

    time_limit = float(
        payload.get("timeLimitSeconds", 15)
    )

    if not 0.1 <= time_limit <= 120:
        raise ValueError("Limite de tiempo invalido")

    pool = {}

    for raw in players:
        if not isinstance(raw, dict):
            continue

        player_id = normalized_id(
            raw.get("playerId", raw.get("id"))
        )

        if not player_id or player_id in excluded_ids:
            continue

        if (
            raw.get("disabled") is True
            or raw.get("status") == "out_injury"
            or raw.get("injuryStatus") == "out"
        ):
            continue

        try:
            salary = int(raw.get("salary"))

            if (
                isinstance(raw.get("salary"), bool)
                or str(raw.get("salary")) != str(salary)
            ):
                continue

            points = score_units(
                raw.get("projectedPoints")
            )

        except (ValueError, TypeError, ArithmeticError):
            continue

        game_id = normalized_id(raw.get("gameId"))
        positions = positions_of(raw)

        if (
            salary <= 0
            or salary > config["salary_cap"]
            or game_id not in allowed_games
            or not positions
        ):
            continue

        player = {
            "playerId": player_id,
            "name": raw.get("name"),
            "teamId": normalized_id(raw.get("teamId")),
            "gameId": game_id,
            "salary": salary,
            "scoreUnits": points,
            "positions": sorted(positions),
        }

        if player_id in pool:
            previous = pool[player_id]

            if previous != player:
                raise ValueError(
                    "Jugador duplicado con datos contradictorios: "
                    + player_id
                )

            continue

        pool[player_id] = player

    if not locked_ids.issubset(pool):
        raise ValueError(
            "Jugador bloqueado ausente o sin datos validos"
        )

    if len(pool) < len(slots):
        return empty_result(
            "INFEASIBLE",
            "not_enough_players",
            sport,
            platform,
        )

    model = cp_model.CpModel()

    # Variable binaria por jugador y slot elegible.
    assignments = {}

    for player_id, player in pool.items():
        for slot_id, eligible in slots.items():

            if set(player["positions"]) & set(eligible):
                assignments[(player_id, slot_id)] = (
                    model.NewBoolVar(
                        f"assign_{len(assignments)}"
                    )
                )

    # Cada posicion debe estar ocupada.
    for slot_id in slots:
        choices = [
            var
            for (pid, sid), var in assignments.items()
            if sid == slot_id
        ]

        if not choices:
            return empty_result(
                "INFEASIBLE",
                "missing_eligible_position",
                sport,
                platform,
            )

        model.Add(sum(choices) == 1)

    # Un jugador no puede ocupar dos posiciones.
    for player_id in pool:
        choices = [
            var
            for (pid, _), var in assignments.items()
            if pid == player_id
        ]

        if choices:
            model.Add(sum(choices) <= 1)

        if player_id in locked_ids:
            if not choices:
                return empty_result(
                    "INFEASIBLE",
                    "locked_player_ineligible",
                    sport,
                    platform,
                )

            model.Add(sum(choices) == 1)

    # Presupuesto total.
    model.Add(
        sum(
            pool[pid]["salary"] * var
            for (pid, _), var in assignments.items()
        ) <= config["salary_cap"]
    )

    # Maximizar puntos Fantasy proyectados.
    model.Maximize(
        sum(
            pool[pid]["scoreUnits"] * var
            for (pid, _), var in assignments.items()
        )
    )

    solver = cp_model.CpSolver()

    solver.parameters.max_time_in_seconds = time_limit
    solver.parameters.num_search_workers = 4

    status_code = solver.Solve(model)

    status = solver.StatusName(status_code)

    if status_code not in (
        cp_model.OPTIMAL,
        cp_model.FEASIBLE,
    ):
        result = empty_result(
            status,
            "no_solution_or_proof" if status != "INFEASIBLE"
            else "no_valid_lineup",
            sport,
            platform,
        )

        result["wallTimeSeconds"] = round(
            solver.WallTime(), 4
        )

        return result

    lineup = []

    for (player_id, slot_id), var in assignments.items():
        if solver.Value(var) != 1:
            continue

        player = pool[player_id]

        lineup.append({
            "slot": slot_id,
            "playerId": player_id,
            "name": player["name"],
            "teamId": player["teamId"],
            "gameId": player["gameId"],
            "salary": player["salary"],
            "positions": player["positions"],
            "projectedPoints": (
                player["scoreUnits"] / SCORE_SCALE
            ),
        })

    slot_order = list(slots)

    lineup.sort(
        key=lambda row: slot_order.index(row["slot"])
    )

    salary = sum(row["salary"] for row in lineup)

    score = sum(
        pool[row["playerId"]]["scoreUnits"]
        for row in lineup
    )

    if (
        len(lineup) != len(slots)
        or len({row["playerId"] for row in lineup}) != len(slots)
        or salary > config["salary_cap"]
        or not locked_ids.issubset(
            {row["playerId"] for row in lineup}
        )
    ):
        raise RuntimeError("Solucion interna invalida")

    return {
        "found": True,
        "mode": "shadow",
        "sport": sport,
        "platform": platform,
        "format": "classic",
        "solver": "ortools-cp-sat",
        "status": status,
        "optimalityGuaranteed": status_code == cp_model.OPTIMAL,
        "contestVerified": False,
        "readyForPublication": False,
        "projectedPoints": score / SCORE_SCALE,
        "salary": salary,
        "salaryCap": config["salary_cap"],
        "remainingSalary": config["salary_cap"] - salary,
        "wallTimeSeconds": round(
            solver.WallTime(), 4
        ),
        "lineup": lineup,
    }


if __name__ == "__main__":
    try:
        payload = json.load(sys.stdin)

        result = optimize(payload)

        print(json.dumps(result))

    except Exception as error:
        print(
            json.dumps({
                "found": False,
                "status": "ERROR",
                "error": str(error),
                "readyForPublication": False,
            })
        )

        sys.exit(1)
