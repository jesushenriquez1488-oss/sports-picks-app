
"""
CashEdge Fantasy Edge - NFL DST Stats Bridge V1

Lee play-by-play real de NFLverse.
Extrae eventos defensivos por equipo y partido.

No inventa puntos permitidos.
No calcula proyecciones.
No escribe en Supabase.
No modifica produccion.

Modo: SHADOW
"""

import io
import json
import sys
import requests
import pandas as pd

BASE_URL = (
    "https://github.com/nflverse/"
    "nflverse-data/releases/download/pbp/"
)

SEASONS = [2025, 2026]

FIELDS = [
    "game_id",
    "game_date",
    "season",
    "week",
    "posteam",
    "defteam",
    "play_id",
    "sack",
    "interception",
    "fumble_lost",
    "fumble_recovery_1_team",
    "fumble_recovery_2_team",
    "touchdown",
    "return_touchdown",
    "return_team",
    "safety",
    "punt_blocked",
    "defensive_two_point_conv",
    "total_home_score",
    "total_away_score",
]

OPTIONAL_FIELDS = [
    "td_team",
    "play_type",
    "kickoff_attempt",
    "punt_attempt",
    "field_goal_attempt",
    "field_goal_result",
    "blocked_player_id",
    "desc",
]

def number(value):
    if pd.isna(value):
        return 0
    try:
        return float(value)
    except (ValueError, TypeError):
        return 0

def team_code(value):
    if pd.isna(value):
        return None
    value = str(value).strip().upper()
    return value if value else None

def download_season(year):
    url = BASE_URL + f"play_by_play_{year}.parquet"

    response = requests.get(url, timeout=120)
    response.raise_for_status()

    data = io.BytesIO(response.content)
    import pyarrow.parquet as pq

    parquet = pq.ParquetFile(data)
    available = set(parquet.schema_arrow.names)

    missing = [field for field in FIELDS
               if field not in available]

    if missing:
        raise RuntimeError(
            f"Missing fields {year}: {missing}"
        )

    selected = FIELDS + [
        field for field in OPTIONAL_FIELDS
        if field in available
    ]

    frame = pd.read_parquet(
        io.BytesIO(response.content),
        columns=selected
    )

    for field in OPTIONAL_FIELDS:
        if field not in frame.columns:
            frame[field] = None

    return frame

def create_record(game_id, team, opponent, season, week, date):
    return {
        "gameId": game_id,
        "team": team,
        "opponent": opponent,
        "season": int(season),
        "week": int(week),
        "gameDate": str(date),
        "stats": {
            "sacks": 0,
            "interceptions": 0,
            "fumble_recoveries": 0,
            "defensive_tds": 0,
            "special_teams_tds": 0,
            "safeties": 0,
            "blocked_kicks": None,
            "two_point_returns": 0,
            "points_allowed": None,
        },
        "unclassifiedEvents": [],
        "complete": False,
        "mode": "SHADOW",
    }

def build_history(frame):
    records = []

    for game_id, game in frame.groupby("game_id"):
        parts = str(game_id).split("_")

        if len(parts) < 4:
            continue

        away = parts[-2]
        home = parts[-1]

        first = game.iloc[0]

        teams = {
            away: create_record(
                game_id, away, home,
                first["season"], first["week"],
                first["game_date"]
            ),
            home: create_record(
                game_id, home, away,
                first["season"], first["week"],
                first["game_date"]
            )
        }

        seen = set()

        for _, play in game.iterrows():
            play_id = play["play_id"]

            if pd.isna(play_id):
                continue

            event_id = (str(game_id), str(play_id))

            if event_id in seen:
                continue

            seen.add(event_id)

            offense = team_code(play["posteam"])
            defense = team_code(play["defteam"])

            if defense in teams:
                stats = teams[defense]["stats"]

                if number(play["sack"]) == 1:
                    stats["sacks"] += 1

                if number(play["interception"]) == 1:
                    stats["interceptions"] += 1

                if number(play["safety"]) == 1:
                    stats["safeties"] += 1

                if number(play["fumble_lost"]) == 1:
                    recovery_teams = {
                        team_code(
                            play["fumble_recovery_1_team"]
                        ),
                        team_code(
                            play["fumble_recovery_2_team"]
                        ),
                    }

                    if defense in recovery_teams:
                        stats["fumble_recoveries"] += 1
                    else:
                        teams[defense][
                            "unclassifiedEvents"
                        ].append({
                            "playId": str(play_id),
                            "reason": "unverified_fumble_recovery"
                        })

                if number(
                    play["defensive_two_point_conv"]
                ) == 1:
                    stats["two_point_returns"] += 1

            if number(play["touchdown"]) == 1:
                scorer = team_code(play["td_team"])

                if scorer not in teams:
                    for team in teams.values():
                        team["unclassifiedEvents"].append({
                            "playId": str(play_id),
                            "reason": "unknown_touchdown_team"
                        })
                    continue

                if number(play["return_touchdown"]) == 1:
                    play_type = str(
                        play["play_type"]
                    ).lower()

                    if play_type in ("kickoff", "punt"):
                        teams[scorer]["stats"][
                            "special_teams_tds"
                        ] += 1

                    elif (
                        defense == scorer
                        and offense != scorer
                        and (
                            number(play["interception"]) == 1
                            or number(play["fumble_lost"]) == 1
                        )
                    ):
                        teams[scorer]["stats"][
                            "defensive_tds"
                        ] += 1

                    else:
                        teams[scorer][
                            "unclassifiedEvents"
                        ].append({
                            "playId": str(play_id),
                            "reason": "unclassified_return_td"
                        })

        for record in teams.values():
            # Pendiente: reconstruir puntos permitidos
            # y validar bloqueos y anotaciones especiales.
            #
            # Nunca sustituir campos desconocidos por 0.
            record["complete"] = False
            records.append(record)

    return records

def main():
    all_records = []

    for year in SEASONS:
        print(f"Loading NFL {year}...", file=sys.stderr)

        frame = download_season(year)
        history = build_history(frame)
        all_records.extend(history)

        unclassified = sum(
            len(item["unclassifiedEvents"])
            for item in history
        )

        print(
            f"{year}: {len(history)} team-games, "
            f"{unclassified} unclassified events",
            file=sys.stderr
        )

    output = {
        "mode": "SHADOW",
        "readyForOptimization": False,
        "readyForPublication": False,
        "seasons": SEASONS,
        "teamGameRecords": len(all_records),
        "records": all_records
    }

    with open(
        "dst-history-shadow.json",
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(output, file, indent=2)

    print(
        "DST bridge extraction complete.",
        file=sys.stderr
    )

if __name__ == "__main__":
    main()
