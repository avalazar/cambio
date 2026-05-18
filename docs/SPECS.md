\# Cambio, Un-Solitaire & Five Suits \- Game Specifications

\#\# 1\. Overview  
\* \*\*Cambio:\*\* A multiplayer memory and strategy card game. The objective is to end the game with the lowest total card value by memorizing cards, using action cards, and swapping high-value cards for lower ones.  
\* \*\*Un-Solitaire:\*\* A cooperative two-player version of Solitaire. The objective is to fully uncover every card in the 52-card deck.  
\* \*\*Five Suits:\*\* A rummy-style multiplayer card game played over 11 rounds. The objective is to form books and runs to go out first, scoring the fewest penalty points across all rounds.

\#\# 2\. Tech Stack  
\* \*\*Backend:\*\* Node.js, Express, Socket.io  
\* \*\*Frontend:\*\* Vanilla JS / HTML / CSS (or React)  
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
\* \*\*Penalty for Incorrect Match:\*\* If a player attempts a match and the chosen card does not match the discard pile, the card is returned, and the player is penalized with an extra card from the draw pile.

\#\#\# 3.6 Calling "Cambio"  
\* Instead of drawing, a player can say "Cambio" on their turn if they believe they have the lowest score.  
\* That player's turn ends. Every other player gets exactly one final turn.  
\* After the final round, all cards are revealed and scores are tallied.  
\* \*Penalty:\* If the player who called Cambio does not have the lowest score, they receive a penalty (e.g., \+10 or \+15 points).

\#\# 4\. Game Rules for Un-Solitaire

\#\#\# 4.1 Setup  
\* Shuffle a standard 52-card deck and create seven columns. Place seven cards in the first column, six in the second, and so on down to one, with only the top card of each pile face up. Deal the remaining cards to both players, with 12 cards each.   
\* The four foundations are built up by suit from Ace (low in this game) to King, and the tableau piles can be built down by alternate colors. Every face-up card in a partial pile, or a complete pile, can be moved, as a unit, to another tableau pile on the basis of its highest card. Empty piles can be filled with a King.  
\* Sorting stage: Allow each player to sort the 12 cards in their hands, so that the leftmost card is placed on top of their hand. 

\#\#\# 4.2 Gameplay Flow  
\* Each player alternates playing a card from their hand, which must always be the top card. If the card cannot be played, it goes on the top of that player’s discard pile. Only the top card can be played from the discard pile.

\#\#\# 4.3 Winning Conditions  
\* The players only win if they successfully uncover all cards from the columns and play all of their hands and discard piles.   
\* There should be a "Give up" button, for the case that the game is not winnable. 

\#\# 5\. Game Rules for Five Suits

\#\#\# 5.1 Setup & The Custom Deck  
\* \*\*The Deck:\*\* A 116-card custom deck. It consists of two combined 58-card decks.  
\* \*\*The Suits:\*\* There are five suits. Each suit has cards ranging from 3 through King (no Aces or 2s).  
    \* \*\*Spades\*\* (Black)  
    \* \*\*Hearts\*\* (Red)  
    \* \*\*Clubs\*\* (Green)  
    \* \*\*Diamonds\*\* (Blue)  
    \* \*\*Stars\*\* (Yellow)  
\* \*\*Jokers:\*\* The deck includes 6 Jokers.

\#\#\# 5.2 Rounds & Wild Cards  
\* The game spans 11 rounds.   
\* \*\*Round 1:\*\* 3 cards dealt to each player. The \*\*3s\*\* are wild.  
\* \*\*Round 2:\*\* 4 cards dealt. The \*\*4s\*\* are wild.  
\* \*(Progression continues until...)\*  
\* \*\*Round 11:\*\* 13 cards dealt. The \*\*Kings\*\* are wild.  
\* Jokers are always wild in every round.

\#\#\# 5.3 Turn Flow  
On a player's turn, they must:  
1\. \*\*Draw:\*\* Take the top card from the face-down draw pile OR the top card from the face-up discard pile.  
2\. \*\*Meld (Optional):\*\* Lay down valid combinations of cards.  
    \* \*\*Books:\*\* 3 or more cards of the exact same rank (e.g., three 5s).  
    \* \*\*Runs:\*\* 3 or more consecutive cards of the \*same suit\* (e.g., 6, 7, 8 of Green Clubs).  
3\. \*\*Discard:\*\* Discard exactly one card to the face-up discard pile to end the turn.

\#\#\# 5.4 Going Out & Scoring  
\* A player "goes out" by melding their entire hand and discarding their final card.   
\* Once a player goes out, all other players get exactly \*\*one final turn\*\* to draw, meld as much as they can, and discard.  
\* \*\*Scoring:\*\* Any cards left in a player's hand that cannot be melded count as penalty points.  
    \* Cards 3 through 9: Face value  
    \* Cards 10 through King: 10 points  
    \* Wild Cards (Current round's wild rank): 20 points  
    \* Jokers: 50 points  
\* The player with the lowest total score at the end of round 11 wins.

\#\# 6\. State Management & Architecture (Socket.io)

\#\#\# 6.1 Server State (The Source of Truth)  
To prevent clients from cheating by inspecting the browser console, the server must be the absolute authority. The state object will differ depending on the selected game mode.  
\* \*\*General Room State:\*\* Room ID, socket IDs of connected players, current Game Mode (Cambio, Un-Solitaire, or Five Suits), Game Phase.  
\* \*\*Cambio Specific State:\*\* Current shuffled deck, Player Hands (4 cards each), Top discard card, Turn Tracker.  
\* \*\*Un-Solitaire Specific State:\*\* Tableau (7 arrays), Foundations (4 arrays), Player Hands (2 arrays), Player Discards (2 arrays), Turn Tracker.  
\* \*\*Five Suits Specific State:\*\*  
    \* \*\*Deck:\*\* Array of the 116 custom cards.  
    \* \*\*Round Tracker:\*\* Integer from 3 to 13 (dictating hand size and wild card).  
    \* \*\*Player Hands:\*\* Arrays of cards held by each player (dynamically sizing).  
    \* \*\*Melds:\*\* Arrays representing the books/runs players have successfully laid down.  
    \* \*\*Discard Pile:\*\* Top card and history.

\#\#\# 6.2 Client State (What the user sees)  
\* \*\*Cambio View:\*\* 4 face-down cards per player, top discard card.  
\* \*\*Un-Solitaire View:\*\* 7-column cascading tableau, 4 foundation slots, local player hand/discard, remote partner hand/discard.  
\* \*\*Five Suits View:\*\*  
    \* Local player's full hand, sorted by suit or rank (UI toggle feature).  
    \* The shared discard pile and draw pile.  
    \* Visual indicator prominently displaying the current Round and Wild Card.  
    \* Area showing all players' played melds on the table.

\#\# 7\. UI & User Experience Flow

\#\#\# 7.1 Lobby Phase  
\* Input field for Username.  
\* \*\*Game Mode Selector:\*\* A toggle or dropdown to select "Cambio", "Un-Solitaire", or "Five Suits".  
\* Button to "Create Room" (generates a unique 4-letter code).  
\* Input to "Join Room" via code.  
\* Lobby screen showing connected players and the selected game mode.

\#\#\# 7.2 Active Game Phase  
\* \*\*Cambio Layout:\*\* Radial/centralized design. User cards at bottom.  
\* \*\*Un-Solitaire Layout:\*\* Standard Solitaire topology.  
\* \*\*Five Suits Layout:\*\* Classic Rummy layout. Wide fan of cards at the bottom for the user's hand. Central area for draw/discard. Dedicated "table" space above the hands for all players to display their melded books and runs. Cards must distinctly use the custom color palette (Black, Red, Green, Blue, Yellow).  
\* \*\*Interactions & Affordances:\*\*  
    \* Active turn indicators.  
    \* Five Suits: Multi-select capability to grab 3+ cards at once to play a meld.  
    \* Un-Solitaire: Drag-and-drop movement.

\#\#\# 7.3 Resolution Phase  
\* \*\*Cambio:\*\* All cards flip face up. Scores calculate.  
\* \*\*Un-Solitaire:\*\* Victory screen on foundation completion, Defeat on "Give Up".  
\* \*\*Five Suits:\*\* A scorecard modal that persists and updates after every round (Rounds 1-11), showing a running tally of penalty points for all players. Winner declared after Round 11\.  
\* "Play Again" button returns players to the lobby.  
