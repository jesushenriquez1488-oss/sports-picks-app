
"""
CashEdge Fantasy Edge - NFL DST Stats Bridge V2

Reconstruye estadísticas DST por equipo y partido
a partir del play-by-play de NFLverse.

SHADOW ONLY.
No modifica Supabase ni producción.
No autoriza optimización ni publicación.
"""

import io
import json
import sys
from collections import Counter

import pandas as pd
import requests
import pyarrow.parquet as pq

BASE_URL = (
    "https://github.com/nflverse/"
    "nflverse-data/releases/download/pbp/"
)

SEASONS = (2025, 2026)

REQUIRED = (
    "game_id",
    "game_date",
    "season",
    "week",
    "play_id",
    "home_team",
    "away_team",
    "home_score",
    "away_score",
    "posteam",
    "defteam",
    "sack",
    "interception",
    "fumble_lost",
    "fumble_recovery_1_team",
    "fumble_recovery_2_team",
    "touchdown",
    "td_team",
    "safety",
    "punt_blocked",
    "total_home_score",
    "total_away_score",
)

OPTIONAL = (
    "return_touchdown",
    "return_team",
    "play_type",
    "kickoff_attempt",
    "punt_attempt",
    "field_goal_attempt",
    "field_goal_result",
    "extra_point_result",
    "two_point_conv_result",
    "defensive_two_point_conv",
    "defensive_extra_point_conv",
    "desc",
)

FIELDS = REQUIRED + OPTIONAL


def value(row, key):
    v = row.get(key)

    if v is None:
        return None

    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        return None

    return v


def team(row, key):
    v = value(row, key)

    if v is None:
        return None

    result = str(v).strip().upper()
    return result if result else None


def flag(row, key):
    v = value(row, key)

    return (
        v is not None
        and str(v).strip().lower()
        in ("1", "1.0", "true")
    )


def integer(row, key):
    v = value(row, key)

    if v is None:
        return None

    try:
        n = float(v)
    except (TypeError, ValueError):
        return None

    return int(n) if n.is_integer() else None


def download_season(year):
    url = (
        BASE_URL
        + f"play_by_play_{year}.parquet"
    )

    response = requests.get(
        url,
        timeout=120
    )
    response.raise_for_status()

    blob = response.content

    parquet = pq.ParquetFile(
        io.BytesIO(blob)
    )

    available = parquet.schema_arrow.names

    missing = sorted(
        set(REQUIRED).difference(available)
    )

    if missing:
        raise RuntimeError(
            f"NFLverse {year} missing fields: "
            f"{missing}"
        )

    columns = [
        col for col in FIELDS
        if col in available
    ]

    frame = pd.read_parquet(
        io.BytesIO(blob),
        columns=columns
    )

    for col in OPTIONAL:
        if col not in frame.columns:
            frame[col] = None

    return frame


def new_record(
    game_id,
    team_code,
    opponent,
    first
):
    return {
        "gameId": str(game_id),
        "team": team_code,
        "opponent": opponent,
        "season": integer(first, "season"),
        "week": integer(first, "week"),
        "gameDate": str(
            value(first, "game_date")
        ),
        "stats": {
            "sacks": 0,
            "interceptions": 0,
            "fumble_recoveries": 0,
            "defensive_tds": 0,
            "special_teams_tds": 0,
            "safeties": 0,
            "blocked_kicks": 0,
            "two_point_returns": 0,
            "points_allowed": 0,
        },
        "unclassifiedEvents": [],
        "complete": False,
        "mode": "SHADOW",
    }


def rebuild_game(game_id, game):
    game = game.sort_values(
        "play_id",
        kind="stable"
    )

    first = game.iloc[0]

    home = team(first, "home_team")
    away = team(first, "away_team")

    if not home or not away or home == away:
        raise ValueError(
            f"Invalid teams: {game_id}"
        )

    records = {
        home: new_record(
            game_id, home, away, first
        ),
        away: new_record(
            game_id, away, home, first
        ),
    }

    teams = (home, away)

    def issue(target, play_id, reason):
        if target in records:
            records[target][
                "unclassifiedEvents"
            ].append({
                "playId": str(play_id),
                "reason": reason,
            })

    def both(play_id, reason):
        for t in teams:
            issue(t, play_id, reason)

    scores = {
        home: 0,
        away: 0,
    }

    seen = set()

    for _, play in game.iterrows():
        play_id = integer(
            play, "play_id"
        )

        if play_id is None:
            both(
                "missing",
                "missing_play_id"
            )
            continue

        if play_id in seen:
            both(
                play_id,
                "duplicate_play_id"
            )
            continue

        seen.add(play_id)

        offense = team(
            play, "posteam"
        )
        defense = team(
            play, "defteam"
        )

        if offense not in records:
            offense = None

        if defense not in records:
            defense = None

        if (
            offense is not None
            and defense == offense
        ):
            both(
                play_id,
                "same_possession_and_defense"
            )
            defense = None

        ptype = str(
            value(play, "play_type") or ""
        ).lower()

        special = (
            flag(play, "kickoff_attempt")
            or flag(play, "punt_attempt")
            or flag(play, "field_goal_attempt")
            or ptype in (
                "kickoff",
                "punt",
                "field_goal"
            )
        )

        is_td = flag(
            play, "touchdown"
        )

        is_pick = flag(
            play, "interception"
        )

        is_fumble = flag(
            play, "fumble_lost"
        )

        is_safety = flag(
            play, "safety"
        )

        is_punt_block = flag(
            play, "punt_blocked"
        )

        is_fg_block = (
            str(
                value(
                    play,
                    "field_goal_result"
                ) or ""
            ).lower() == "blocked"
        )

        is_xp_block = (
            str(
                value(
                    play,
                    "extra_point_result"
                ) or ""
            ).lower() == "blocked"
        )

        is_fg = (
            str(
                value(
                    play,
                    "field_goal_result"
                ) or ""
            ).lower() == "made"
        )

        is_xp = (
            str(
                value(
                    play,
                    "extra_point_result"
                ) or ""
            ).lower() == "good"
        )

        is_two = (
            str(
                value(
                    play,
                    "two_point_conv_result"
                ) or ""
            ).lower() == "success"
        )

        is_conversion_return = (
            flag(
                play,
                "defensive_two_point_conv"
            )
            or flag(
                play,
                "defensive_extra_point_conv"
            )
        )

        # Sacks e intercepciones.

        if flag(play, "sack"):
            if defense:
                records[defense][
                    "stats"
                ]["sacks"] += 1
            else:
                both(
                    play_id,
                    "sack_without_defense"
                )

        if is_pick:
            if defense:
                records[defense][
                    "stats"
                ]["interceptions"] += 1
            else:
                both(
                    play_id,
                    "interception_without_defense"
                )

        # Recuperaciones de fumble.
        # Una misma jugada nunca se cuenta dos veces.

        if is_fumble:
            recovery_teams = {
                team(
                    play,
                    "fumble_recovery_1_team"
                ),
                team(
                    play,
                    "fumble_recovery_2_team"
                ),
            } - {None}

            if (
                defense
                and defense in recovery_teams
                and offense != defense
            ):
                records[defense][
                    "stats"
                ]["fumble_recoveries"] += 1

            elif defense:
                issue(
                    defense,
                    play_id,
                    "unverified_fumble_recovery"
                )
            else:
                both(
                    play_id,
                    "unverified_fumble_recovery"
                )

        # Safety.

        if is_safety:
            if defense:
                records[defense][
                    "stats"
                ]["safeties"] += 1
            else:
                both(
                    play_id,
                    "safety_without_defense"
                )

        # Patadas bloqueadas.
        # Un bloqueo por jugada como máximo.

        if (
            is_punt_block
            or is_fg_block
            or is_xp_block
        ):
            if defense:
                records[defense][
                    "stats"
                ]["blocked_kicks"] += 1
            else:
                both(
                    play_id,
                    "blocked_kick_without_defense"
                )

        # Retornos de conversiones.

        if is_conversion_return:
            if defense:
                records[defense][
                    "stats"
                ]["two_point_returns"] += 1
            else:
                both(
                    play_id,
                    "conversion_return_without_defense"
                )

        # Reconstrucción del marcador.
        # total_*_score representa el marcador
        # al finalizar la jugada.

        h = integer(
            play,
            "total_home_score"
        )

        a = integer(
            play,
            "total_away_score"
        )

        scorer = None
        points = 0

        if h is not None and a is not None:
            dh = h - scores[home]
            da = a - scores[away]

            if (
                dh < 0
                or da < 0
                or (dh > 0 and da > 0)
            ):
                both(
                    play_id,
                    "invalid_score_transition"
                )

            elif dh > 0:
                scorer = home
                points = dh

            elif da > 0:
                scorer = away
                points = da

            scores[home] = h
            scores[away] = a

        else:
            both(
                play_id,
                "score_unavailable"
            )

        # Identificación de touchdowns.

        td_team = team(
            play,
            "td_team"
        )

        if is_td:
            if td_team in records:
                td_scorer = td_team

                if (
                    scorer is not None
                    and td_team != scorer
                ):
                    both(
                        play_id,
                        "td_team_score_mismatch"
                    )

            elif scorer:
                td_scorer = scorer

            else:
                td_scorer = None
                both(
                    play_id,
                    "touchdown_team_unknown"
                )

            if td_scorer:
                if special:
                    records[td_scorer][
                        "stats"
                    ]["special_teams_tds"] += 1

                elif (
                    offense
                    and td_scorer != offense
                    and defense == td_scorer
                ):
                    if (
                        is_pick
                        or is_fumble
                        or flag(
                            play,
                            "return_touchdown"
                        )
                    ):
                        records[td_scorer][
                            "stats"
                        ]["defensive_tds"] += 1

                    else:
                        issue(
                            td_scorer,
                            play_id,
                            "unknown_defensive_td_type"
                        )

                elif offense == td_scorer:
                    # Touchdown ofensivo:
                    # no se acredita a DST.
                    pass

                else:
                    both(
                        play_id,
                        "touchdown_context_unknown"
                    )

        # Clasificación de puntos permitidos.

        if not scorer:
            if (
                is_td
                or is_fg
                or is_xp
                or is_two
                or is_safety
                or is_conversion_return
            ):
                both(
                    play_id,
                    "score_flag_without_score_delta"
                )
            continue

        opponent = (
            away if scorer == home
            else home
        )

        if is_td:
            if special:
                records[opponent][
                    "stats"
                ]["points_allowed"] += points

            elif offense == scorer:
                records[opponent][
                    "stats"
                ]["points_allowed"] += points

            elif (
                defense == scorer
                and offense == opponent
            ):
                # Pick-six o TD defensivo contra
                # la ofensiva del rival.
                # No penaliza la DST del rival.
                pass

            else:
                issue(
                    opponent,
                    play_id,
                    "td_points_allowed_unknown"
                )

        elif is_fg or is_xp or is_two:
            if (
                scorer == offense
                or offense is None
            ):
                records[opponent][
                    "stats"
                ]["points_allowed"] += points

            else:
                issue(
                    opponent,
                    play_id,
                    "conversion_points_allowed_unknown"
                )

        elif is_conversion_return:
            # Retorno contra la unidad ofensiva
            # que intentaba la conversión.
            pass

        elif is_safety:
            if special:
                records[opponent][
                    "stats"
                ]["points_allowed"] += points

            elif (
                defense == scorer
                and offense == opponent
            ):
                # Safety sufrido por la ofensiva.
                pass

            else:
                issue(
                    opponent,
                    play_id,
                    "safety_points_allowed_unknown"
                )

        else:
            issue(
                opponent,
                play_id,
                "scoring_event_unclassified"
            )

    # Validación contra marcador oficial final.

    final = {
        home: integer(
            first, "home_score"
        ),
        away: integer(
            first, "away_score"
        ),
    }

    if any(
        final[t] is None
        or scores[t] != final[t]
        for t in teams
    ):
        both(
            "final",
            "final_score_mismatch"
        )

    for team_code in teams:
        record = records[team_code]

        record["complete"] = (
            len(
                record["unclassifiedEvents"]
            ) == 0
        )

    return list(records.values())


def build_history(frame):
    if frame.empty:
        return []

    result = []

    for game_id, game in frame.groupby(
        "game_id",
        sort=True
    ):
        result.extend(
            rebuild_game(
                game_id,
                game
            )
        )

    return result


def main():
    all_records = []

    for season in SEASONS:
        print(
            f"Loading NFL {season}...",
            file=sys.stderr
        )

        frame = download_season(season)
        records = build_history(frame)

        all_records.extend(records)

        reasons = Counter(
            event["reason"]
            for record in records
            for event in record[
                "unclassifiedEvents"
            ]
        )

        complete = sum(
            record["complete"]
            for record in records
        )

        print(
            f"{season}: "
            f"{len(records)} team-games, "
            f"{complete} complete",
            file=sys.stderr
        )

        print(
            "Unclassified:",
            dict(reasons),
            file=sys.stderr
        )

    output = {
        "mode": "SHADOW",
        "readyForOptimization": False,
        "readyForPublication": False,
        "seasons": list(SEASONS),
        "teamGameRecords": len(
            all_records
        ),
        "records": all_records,
    }

    with open(
        "dst-history-shadow.json",
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            output,
            file,
            indent=2
        )

    print(
        "DST bridge extraction audit complete.",
        file=sys.stderr
    )

    print(
        "Historical scoring NOT certified.",
        file=sys.stderr
    )


if __name__ == "__main__":
    main()
