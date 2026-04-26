\# Cambio & Un-Solitaire \- Game Specifications

\#\# 1\. Overview  
Cambio is a multiplayer memory and strategy card game. The objective is to end the game with the lowest total card value by memorizing cards, using action cards, and swapping high-value cards for lower ones.

Un-Solitaire is a cooperative two-player version of Solitaire. The objective is to fully uncover every card in the 52-card deck.

\#\# 2\. Tech Stack  
\* \*\*Backend:\*\* Node.js, Express, Socket.io  
\* \*\*Frontend:\*\* Vanilla JS / HTML / CSS (or React, depending on your preference)  
\* \*\*Deployment:\*\* TBD (e.g., Render, Heroku)

\#\# 3\. Game Rules for Cambio

\#\#\# 3.1 Setup  
\* \*\*Deck:\*\* Standard 52-card deck.  
\* \*\*Deal:\*\* Each player is dealt exactly 4 cards face down in a 2x2 grid or a single row.  
\* \*\*Initial Peek:\*\* Before the first turn, each player may privately look at the bottom 2 of their cards.  
\* \*\*Play Area:\*\* One draw pile (face down) and one discard pile (face up).

\#\#\# 3.2 Card Values (End Game Scoring)  
\* \*\*Red Kings:\*\* \-1   
\* \*\*Black Kings, Queens & Jacks:\*\* 10  
\* \*\*Numbered Cards (2-10):\*\* Face value  
\* \*\*Aces:\*\* 1

\#\#\# 3.3 Turn Flow  
On a player's turn, they must:  
 \*\*Draw from the Deck:\*\* Look at the top card of the deck privately and either:  
    \* Swap it with one of their face-down cards.  
    \* Discard it immediately.  
    \* If the discarded card is an \*\*Action Card\*\* (7 through King), they may immediately use its ability.

\#\#\# 3.4 Action Cards (When drawn from deck and discarded)  
\* \*\*7 or 8:\*\* \*\*Peek\*\* \- Look at one of your own face-down cards.  
\* \*\*9 or 10:\*\* \*\*Spy\*\* \- Look at one face-down card of another player.  
\* \*\*Jack or Queen:\*\* \*\*Blind Swap\*\* \- Swap any one of your cards with any other player's card without looking at either.  
\* \*\*Black King:\*\* \*\*Look & Swap\*\* \- Look at another player's card and optionally swap it with yours.

\#\#\# 3.5 Matching Discards (Out of Turn Action)  
\* \*\*Self Match:\*\* If a player has a face-down card with the exact same numeric value as the top card of the discard pile, they can immediately discard it, regardless of whose turn it is.  
\* \*\*Opponent Match:\*\* If a player knows that an opponent has a face-down card with the same numeric value as the top discarded card, they can discard their opponent's card and give that opponent one of their own face-down cards in exchange.  
\* \*\*Penalty for Incorrect Match:\*\* If a player attempts a match (on themselves or an opponent) and the chosen card does not match the discard pile, the card is returned to its original place, and the player who made the incorrect attempt is penalized by having an extra card from the draw pile added to their hand.

\#\#\# 3.6 Calling "Cambio"  
\* Instead of drawing, a player can say "Cambio" on their turn if they believe they have the lowest score.  
\* That player's turn ends. Every other player gets exactly one final turn.  
\* After the final round, all cards are revealed and scores are tallied.  
\* \*Penalty:\* If the player who called Cambio does not have the lowest score, they receive a penalty (e.g., \+10 or \+15 points).

\#\# 4\. Game Rules for Un-Solitaire

\#\#\# 4.1 Setup  
\* Shuffle a standard 52-card deck and create seven columns. Place seven cards in the first column, six in the second, and so on down to one, with only the top card of each pile face up. Deal the remaining cards to both players, with 12 cards each.   
\* The four foundations (light rectangles in the upper right of the figure) are built up by suit from Ace (low in this game) to King, and the tableau piles can be built down by alternate colors. Every face-up card in a partial pile, or a complete pile, can be moved, as a unit, to another tableau pile on the basis of its highest card. Any empty piles can be filled with a King, or a pile of cards with a King. The aim of the game is to build up four stacks of cards starting with Ace and ending with King, all of the same suit, on one of the four foundations, at which time the player would have won.  
\* Sorting stage: Allow each of the players to sort the 12 cards in their hands, so that the leftmost card is placed on top of their hand. 

\#\#\# 4.2 Gameplay Flow  
\* Each player alternates playing a card from their hand, which must always be the top card. If the card cannot be played, it goes on the top of that player’s discard pile. Only the top card can be played from the discard pile.

\#\#\# 4.3 Winning Conditions  
\* The players only win if they successfully uncover all cards from the columns and play all of their hands and discard piles.   
\* There should be a “Give up” button, for the case that the game is not winnable. 

\#\# 5\. State Management & Architecture (Socket.io)

\#\#\# 5.1 Server State (The Source of Truth)  
To prevent clients from cheating by inspecting the browser console, the server must be the absolute authority. The state object will differ depending on the selected game mode.  
\* \*\*General Room State:\*\* Room ID, socket IDs of connected players, current Game Mode (Cambio or Un-Solitaire), Game Phase (Waiting, Dealing, Playing, Resolution).  
\* \*\*Cambio Specific State:\*\* \* Current shuffled deck array.  
    \* Player Hands (arrays of cards each player holds).  
    \* Top card of the discard pile.  
    \* Turn Tracker (index of whose turn it is).  
\* \*\*Un-Solitaire Specific State:\*\*  
    \* \*\*Tableau:\*\* 7 arrays representing the columns (tracking both face-up and face-down cards).  
    \* \*\*Foundations:\*\* 4 arrays tracking the top card built for each suit.  
    \* \*\*Player Hands:\*\* 2 arrays representing the 12-card hands (only the top card is playable).  
    \* \*\*Player Discards:\*\* 2 arrays representing each player's individual discard pile.  
    \* Turn Tracker for alternating plays.

\#\#\# 5.2 Client State (What the user sees)  
The client maintains a lightweight state purely for rendering the visual hierarchy and temporary user interactions.  
\* \*\*Cambio View:\*\* Visual representation of 4 face-down cards per player, top card of the main discard pile, draw pile count, and locally cached UI states for legally peeked cards.  
\* \*\*Un-Solitaire View:\*\* \* The centralized 7-column cascading tableau and 4 foundation slots.  
    \* The local player's hand (showing the playable top card) and their personal discard pile.  
    \* The remote partner's hand and discard pile to track their available moves.  
    \* Selected card/stack state (for drag-and-drop or click-to-move affordances).

\#\# 6\. UI & User Experience Flow

\#\#\# 6.1 Lobby Phase  
\* Input field for Username.  
\* \*\*Game Mode Selector:\*\* A prominent toggle or dropdown to select either "Cambio" or "Un-Solitaire" before creating a room.  
\* Button to "Create Room" (generates a unique 4-letter code).  
\* Input to "Join Room" via code.  
\* Lobby screen showing connected players and the selected game mode.  
\* Host has a "Start Game" button.

\#\#\# 6.2 Active Game Phase  
The workspace must dynamically render the appropriate layout based on the active game mode.  
\* \*\*Cambio Layout:\*\* Radial or centralized design. The user's cards sit at the bottom viewport edge. Opponents are arrayed around the top and sides. The draw and discard piles anchor the center.  
\* \*\*Un-Solitaire Layout:\*\* Standard Solitaire topology. Foundations at the top-right, Tableau cascading in the center. Player 1's hand/discard dock on the bottom-left, Player 2's hand/discard dock on the bottom-right (or top-left).  
\* \*\*Interactions & Affordances:\*\* \* Active turn indicators (glows/borders).  
    \* Toast notifications or modals for system messaging (e.g., "Invalid match attempt\! \+1 Card penalty").  
    \* For Un-Solitaire: Intuitive drag-and-drop or tap-to-select movement for shifting tableau stacks.  
\* \*\*Utility:\*\* A clearly accessible "Give Up" button rendered only during Un-Solitaire.

\#\#\# 6.3 Resolution Phase  
\* \*\*Cambio:\*\* All cards flip face up simultaneously. Scores animate and calculate dynamically next to each player's avatar. Winner declared.  
\* \*\*Un-Solitaire:\*\* Triggered when all foundation piles are complete (Victory screen) or when "Give Up" is pressed (Defeat screen).   
\* "Play Again" button returns players to the lobby, allowing them to switch game modes if desired.

