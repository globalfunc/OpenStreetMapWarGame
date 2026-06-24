### Purpose
Create specification for a flat 2d game that recreates a fictional invasion of the Vatican city by Italian goverment forces;


The map is a 2d of the vatican city https://www.openstreetmap.org/#map=17/41.903678/12.455095

### Players
Types: 
- Tanks (Italian only)
    - Tank figure (side profile of tank)
- Soldiers
    Soldier figurines: Flat icons of soldier profile hodling a rifle.

Color: Blue for Italian (offenders), Yellow for Vatican (defenders)

I can give you cooridinate locations of both parties positions. 
Italian army: 15 soldiers and 4 tanks

Vatican army: 10 soldiers

### Rules

Tanks can move 6 square units and then fire

Soldiers can move up to 3 square units and fire (or 5 units and not fire)

Players can skip turns.

Make a circular wheel of fortune with the following sections (pie chart): 2 rifleman sections (opposite to each other, blue color), 1 tank (olive green color), 1 granade, 1 surrender flag (white flag), 1 green star.

The players turn the wheel by clicking on a Turn wheel button and the wheel starts rotating (the button is displayed flashing in the current player's color (blue or yellow)). When the button is clicked the wheel starts rotating at random speed for 4 seconds (slowing down until full stop, whatever section is pointed by the wheel's arrow resolves the selected fortune item).

Items:
Rifleman -> Can take 5 health points from one soldier unit within a radius of 4 squares (for soldiers) and 10 squares (for tanks)
Tank -> Can take 10 health points from one tank unit within a radius of 4 squares (for soldiers) and 10 squares (for tanks)
Granade -> Can take all health points from one tank or soldier unit within a radius of up to 4 squares (for soldiers) and up to 10 squares (for tanks)
Green star -> Regenerates 10 health points to the unit (or to the maximum if health is less then 10 points from maximum value).
Surrener flag -> user skips turn.

If two or more figurines end on same square use split view and display them both without overlapping.

### Chonology of turns and events

1. Player chooses a figurine to play with
2. Clicks on the Turn wheel button
3. Moves the unit up to the maximum number of allowed squares along a path and Depending on what fortune item has been gifted -> chooses enemy figurine within the aforementioned radius (after movement). The figurine health is deducted respectively or the unit is killed (in case of granade).
The player can decide not to move and directly hit a target nearby or skip turn or move away from the enemy.
4. Its the other player's turn

The hame ends when one of the players has no army left. A confetti screen with victory message (Italy won! Viva Italy! or Vatican defended the fortress! Long live the Pope! is displayed respectively with nice animation and celebration confetti + war medals and laurel crown as victory symbols).

### Health points
Tanks -> 30 health points
Soldiers -> 10 health points


### Selectable Targets

After moving tanks can select a target up to 10 squares away.
After moving soldiers can select a target up to 4 squares away.

If green star is used the player's currenlty selected figurine health is regenerated +10 health points (capped to maximum health)

If surrender flag is used (the selected figurine skips turn)


### Movement
Units move along predefined pathways (use the streets as legal pathways, can you extract/parse street pathways from openstreetmap? or do other map api).
Inside the buildings use simple straight lines and cross overs so the units can move in the the buildings (let me know if a grid system or predefined paths (end to end) is simpler).


For demo version 1 of the game you can use simplified 2d canvas of the vatican city or simpler map to test the approach and then move on to full representation of the city pathways, streets, parks and buildings. I can give you a snapshot of the 2d map.


Polish this plan, ask me questions if something is not clear or needs further specifications. This is a draft mindmap of a simple 2 player game. 

Let me know of possible approaches this can be done, the most technical aspect is the map and pathways mapping + character position at selected coordinates.

Consider having the option to configure the unit positions before the game starts (first Italian offenders put tank or soldier (choose ) and place it in a grid path square), then do the same for the Vatican defenders). The figurines are with vivid colors, the game is not dark but with standard light map view. Selected figurines are flashing subtly, attacked figurines are also flashing subtly with red nuance if taking damage. Regenration is visually aided with + signs wrapped in circles, emerging from the figurine .


### Tech stack

3D Engine: Three.js or Babylon.js. Consider using pure javascript, react possibly. 
Stack is up to you to decide but should be minimal, lightweight and simple for a proof of concept game.
No security or profile creation or payments or anything SaaS related. Just simple 2 player game that can be played in the browser (purely clientside).

I want a proof of concept.

Now ask me questions, details, specifics and lets go thogether to polish this into a fully qualified spec that can create a basic but satisfying game. 
Let me know of laternative mapping approaches (screenshots or if you need specific map apis to extract coordinates and create a grid system and pathways) or offer simplistic alternative that does not damage the gaming experience.

This is greenfield project, no files or other assets exist. 
This game is for me and my son only, no commercial use is intended.