# ASX Arcade - SOLO / OFFLINE version (no outside websites needed)

Use this when the school laptops block the hosting site or the live room.

## Get it onto the laptops
1. Send the zip through something the school allows (Teams, OneDrive, school email, USB).
2. On each laptop: right-click the zip > Extract all. Open the folder and double-click **index.html** (opens in Chrome or Edge).
   Nothing is installed and nothing connects to the internet.

## Play (solo mode)
1. Students type first name + last initial and the **same class code** (e.g. COM9A). Everyone with the same code gets the same prices and news.
2. Press **"No teacher link? Play SOLO"**.
3. When you say GO, everyone presses the green **GO!** button together.
4. The game ends by itself after **90 market days (15 minutes)**. To change this, open script.js and edit `SOLO_END_DAY` near line 57 (10 seconds = 1 market day).
   Students can also end early: Settings > "Finish my game now".
5. The final screen shows each student's **final net worth**. Students tell you or hold up the number. The highest wins.

## What is different from the live version
- No live ranking, no teacher Start/Pause/Market End, no Event desk. Each laptop runs its own clock.
- Students who join late are behind on the clock (so press GO together).
- If a student reloads the page, a GO! button comes back so they can carry on.
- The live version still works in this folder (START GAME button) if the school allows it, but only the solo button works with no internet at all.
