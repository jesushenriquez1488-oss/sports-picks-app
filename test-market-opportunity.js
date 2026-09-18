require("dotenv").config({
  path: ".env.local"
});

const {
  createClient
} = require("@supabase/supabase-js");

const {
  calculateMarketOpportunity
} = require("./lib/marketOpportunities");

const supabaseAdmin =
  createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );


async function main() {

  const {
    data: games,
    error
  } =
    await supabaseAdmin
      .from("market_pick_context")
      .select(`
        cashedge_game_id,
        sport,
        canonical_pick
      `)
      .eq(
        "current_is_premium",
        true
      )
      .limit(20);


  if (error) {
    throw error;
  }


  console.log(
    `\nTesting ${games.length} Premium games...\n`
  );


  for (const game of games) {

    try {

      const result =
        await calculateMarketOpportunity({
          supabaseAdmin,
          gameId:
            game.cashedge_game_id
        });


      console.log(
        "===================================="
      );

      console.log(
        game.sport,
        "|",
        game.canonical_pick
      );

      console.log(
        "Game:",
        game.cashedge_game_id
      );

      console.log(
        "Market:",
        result.marketType,
        result.selectionKey
      );

      console.log(
        "Market now:",
        result.marketNow || null
      );

      console.log(
        "Best:",
        result.bestLine || null
      );

      console.log(
        "Best books:",
        result.bestBooks || []
      );

      console.log(
        "Opportunity:",
        result.opportunity || null
      );


    } catch (error) {

      console.error(
        "ERROR:",
        game.cashedge_game_id,
        error.message
      );
    }
  }
}


main()
  .then(() => {

    console.log(
      "\nDONE\n"
    );

    process.exit(0);
  })
  .catch(error => {

    console.error(error);

    process.exit(1);
  });
