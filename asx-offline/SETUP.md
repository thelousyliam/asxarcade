# ASX Arcade – how to run a lesson

## What you need (once)
The game is a handful of files. Students need a **web address** to open them, so put the folder on any free
static host. The easiest are **Netlify Drop** (drag the whole folder onto app.netlify.com/drop) or **GitHub Pages**.
Nothing else to set up: no database, no accounts, no keys.

## Every lesson
1. Open **your hosted** `master.html` (not the file on your computer, or the student link will be wrong).
2. Type a **class code** (or press 🎲) and press **OPEN THE ROOM**. Wait for the green "Room open".
3. Give students the **student link** (it already has the code inside) or tell them the code.
4. Students type their name (first name + last initial) and appear on your ranking straight away.
5. Press **▶ START THE CLOCK** when you are ready. Press **⏸ PAUSE** to stop everyone.
   - 10 real seconds = 1 trading day. Prices change twice a day. Tax Day (and the 50% tax discount for holding a share a full tax year) = every 30 trading days = 5 minutes.
   - Money from a sale arrives 4 trading days later (40 seconds). Students see a live **tax estimate** (what they would pay if they sold everything now, and what % of their profit that is).
   - **Students can still buy and sell while you have paused** (time stops, prices stay still).
   - 6 sectors (Mining, Gold, Banking, Tech, Healthcare, Retail) with 2 companies each.
   - Random news every 8-16 trading days (about every 1.5-2.5 minutes): 50% one sector up or down, 30% mixed (1-2 sectors up and 1-2 down), 10% world crash, 10% world rise (shuffled in decks of 20, so the mix is fair). Pop-ups close by themselves after 6 seconds and **students cannot skip them**.
   - Dividends are paid every 2 trading days.
   - **🏁 MARKET END** finishes the game: the clock stops, trading closes, and you get the final leaderboard with a podium (and a CSV download). Students see "Game over", their own final rank and the top 3. **Reopen the market** undoes it.
   - "Pause automatically when big news happens" (off by default) stops the game at each news story so you can talk about it.
   - "Let students see their own rank" is off by default.

Keep the dashboard tab open and visible while you teach.

## Your own news (Event desk)
Open **📢 Event desk** on the dashboard. Pick a ready-made story (or write your own headline), press the arrows for each sector
(▼▼ big fall, ▼ small fall, – none, ▲ small rise, ▲▲ big rise), then **SEND EVENT TO STUDENTS**.
- It shows to every student about 4+ seconds of running time later (it waits if the clock is paused) and only changes **future** prices, never past trades.
- Each day can hold one news story. If you send two, the second goes to the next free day. You can **Cancel** an event that has not happened yet.
- Your events are saved in your browser with the class code. If you open the same class code on a different computer, your earlier events will not be there.

## Keeping the game going across lessons
- Open the dashboard **on the same computer and browser** and use the **same class code**: the clock and every student's
  trades continue where you stopped (paused).
- Students can come back on a **different computer**: when they type the same name, you send their trades back to them.
- For a completely fresh game, use a **new class code**.

## Things to know
- Students cannot start, stop or speed up time. Only the dashboard controls the clock.
- If a student loses connection, their game freezes and reconnects by itself. If **you** close the dashboard, every
  student freezes (nothing is lost).
- Scores are recalculated on your page from each student's trade log, so they cannot be edited.
- Prices are pretend (made up by the class code). They are not real ASX prices.
- The live link uses PeerJS (free public connection server). **Please test once with your own laptop + one student
  device on the school Wi-Fi before the lesson.** Some school networks block this kind of connection.

## Settings you can change (top of `engine.js`, open in Notepad)
- `SECONDS_PER_MARKET_DAY` – game speed (10 = 10 real seconds per trading day).
- `YEAR_DAYS` – days between Tax Days (and for the 50% discount). Minutes = YEAR_DAYS x seconds per day / 60 (30 x 10 / 60 = 5 minutes).
- `SETTLE_DAYS` – how many trading days a sale takes to turn into cash (4).
- `DIV_EVERY` – dividends every this many trading days. `DIV_BOOST` – 1 = realistic size, 2 or 3 = bigger dividends.
- `VOL_SCALE` – lower (e.g. 0.5) = calmer, more gradual daily price moves.
- News timing: `EVENT_GAP_MIN` and `EVENT_GAP_MAX` (8 and 16 trading days between news stories). News stories: `STORIES` and `GLOBAL_STORIES`. The 50/30/10/10 mix: `buildDeck`.
- Companies and sectors: `STOCKS` and `SECTORS` (keep 2 companies per sector).
- `EVENT_SECONDS` in `script.js` – how long news pop-ups stay (6).
Start a **new class code** after changing speed settings, because old trades will not match.
- Charts: 1 day, 1 week, 1 month, 1 year, 5 years. The price history from **before** the game starts is made up (so the long charts are not empty).
- Old versions: after you upload new files, students must refresh (Ctrl+F5). A student with an old cached page is told to refresh.
