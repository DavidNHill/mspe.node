
"use strict";

console.log('At start of main.js');

var TILE_SIZE = 20;
const DIGIT_HEIGHT = 38;
const DIGIT_WIDTH = 22;
const DIGITS = 5;

const CYCLE_DELAY = 100;  // minimum delay in milliseconds between processing cycles

// offset 0 - 8 are the numbers and the bomb, hidden and flagged images are defined below
const BOMB = 9;
const HIDDEN = 10;
const FLAGGED = 11;
const FLAGGED_WRONG = 12;
const EXPLODED = 13;

// holds the images
var images = [];
var imagesLoaded = 0;
var led_images = [];

var canvasLocked = false;   // we need to lock the canvas if we are auto playing to prevent multiple threads playing the same game

const canvas = document.getElementById('myCanvas');
const ctx = canvas.getContext('2d');

const docMinesLeft = document.getElementById('myMinesLeft');
const ctxBombsLeft = docMinesLeft.getContext('2d');

const canvasHints = document.getElementById('myHints');
const ctxHints = canvasHints.getContext('2d');

const runSeed = document.getElementById('runSeed');
const runBoard = document.getElementById('runBoard');
const runGames = document.getElementById('runGames');
const runOutput = document.getElementById('runOutput');

const runTieBreak = document.getElementById('allowTieBreak');
const runDeadTileAnalysis = document.getElementById('doDeadTileAnalysis');
const run5050Check = document.getElementById('do5050Check');
const runBFDAThreshold = document.getElementById('bfdaThreshold');
const runAnimate = document.getElementById('animate');

var currentGameDescription;

var board;

var oldrng = false;

docMinesLeft.width = DIGIT_WIDTH * DIGITS;
docMinesLeft.height = DIGIT_HEIGHT;

var analysisMode = false;

var dragging = false;  //whether we are dragging the cursor
var dragTile;          // the last tile dragged over
var analysing = false;  // try and prevent the analyser running twice if pressed more than once


// things to do to get the game up and running
async function startup() {

    console.log("At start up...");

     // create an initial analysis board
    board = new Board(1, 30, 16, 0, 0, "");
    board.setAllZero();

    resizeCanvas(board.width, board.height);

    browserResized();

    runSeed.value = "12345";
    runBoard.value = "30x16/99";
    runGames.value = "1000";
    runBFDAThreshold.value = "200";

    //renderHints([]);  // clear down hints

    renderTiles(board.tiles); // draw the board

    updateMineCount(board.bombs_left);  // reset the mine count

}

async function doSolve() {

    const options = {};
    options.allowDeadTileAnalysis = runDeadTileAnalysis.checked;
    options.allowTieBreak = runTieBreak.checked;
    options.allow5050Check = run5050Check.checked;
    options.bruteForceThreshold = parseInt(runBFDAThreshold.value);

    solve(board, options, true);

}

async function solve(workBoard, options, animate) {

    const message = {};

    if (options != null) {
        message.options = options;
    }

    // create the board dimensions
    const mb = {};
    mb.width = workBoard.width;
    mb.height = workBoard.height;
    mb.mines = workBoard.num_bombs;

    // create the tile details for revealed tiles
    const tiles = [];
    for (const tile of workBoard.tiles) {

        if (!tile.isCovered()) {
            const t = {};
            t.x = tile.x;
            t.y = tile.y;
            t.value = tile.getValue();
            tiles.push(t);
        } 

    }

    message.board = mb;
    message.tiles = tiles;

    const outbound = JSON.stringify(message);
    if (animate) {
        console.log("==> " + outbound);
    }


    const json_data = await fetch("/solve", {
        method: "POST",
        body: outbound,
        headers: new Headers({
            "Content-Type": "application/json"
        })
    });
    const reply = await json_data.json();

    if (animate) {
        console.log("<== " + JSON.stringify(reply));
    }
 
    if (reply.valid && runAnimate.checked) {
        renderHints(reply.tiles);
    }

    return reply;
}

// render an array of tiles to the canvas
async function renderHints(hints) {

    //console.log(hints.length + " hints to render");

    ctxHints.clearRect(0, 0, canvasHints.width, canvasHints.height);

     // put percentage over the tile 
    if (TILE_SIZE == 12) {
        ctxHints.font = "7px serif";
    } else if (TILE_SIZE == 16) {
        ctxHints.font = "10px serif";
    } else if (TILE_SIZE == 20) {
        ctxHints.font = "12px serif";
    } else if (TILE_SIZE == 24) {
        ctxHints.font = "14px serif";
    } else if (TILE_SIZE == 28) {
        ctxHints.font = "16px serif";
    } if (TILE_SIZE == 32) {
        ctxHints.font = "21px serif";
    } else {
        ctxHints.font = "6x serif";
    }

    ctxHints.globalAlpha = 1;
    ctxHints.fillStyle = "black";
    for (var tile of hints) {

        if (tile.dead != null) {
            ctxHints.globalAlpha = 0.33;
            ctxHints.fillStyle = "black";
            ctxHints.fillRect(tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
        if (tile.safety == 1) {
            ctxHints.globalAlpha = 0.5;
            ctxHints.fillStyle = "green";
            ctxHints.fillRect(tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        } else if (tile.play != null) {
            ctxHints.globalAlpha = 0.5;
            ctxHints.fillStyle = "orange";
            ctxHints.fillRect(tile.x * TILE_SIZE, tile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }

        ctxHints.globalAlpha = 1;
        ctxHints.fillStyle = "black";

        var value = (1 - tile.safety) * 100;
  
        if (value < 9.95) {
            var value1 = value.toFixed(1);
        } else {
            var value1 = value.toFixed(0);
        }

        var boardTile = board.getTileXY(tile.x, tile.y);

        var draw = true;
        if (boardTile.isFlagged()) {  // don't draw if mine and flagged
            if (value1 == 100) {
                draw = false;
            }
        }

        if (draw) {
            var offsetX = (TILE_SIZE - ctxHints.measureText(value1).width) / 2;

            ctxHints.fillText(value1, tile.x * TILE_SIZE + offsetX, (tile.y + 0.7) * TILE_SIZE, TILE_SIZE);
        }

    }

}

// render an array of tiles to the canvas
function renderTiles(tiles) {

    //console.log(tiles.length + " tiles to render");

    for (var i = 0; i < tiles.length; i++) {
        var tile = tiles[i];
        var tileType = HIDDEN;

        if (tile.isBomb()) {
            if (tile.exploded) {
                tileType = EXPLODED;
            } else {
                tileType = BOMB;
            }
 
        } else if (tile.isFlagged()) {
            if (tile.isBomb() == null || tile.isBomb()) {  // isBomb() is null when the game hasn't finished
                tileType = FLAGGED;
            } else {
                tileType = FLAGGED_WRONG;
            }

        } else if (tile.isCovered()) {
            tileType = HIDDEN;

        } else {
            tileType = tile.getValue();
        }
        draw(tile.x, tile.y, tileType);
    }


}

function updateMineCount(minesLeft) {

    var work = minesLeft;
    var digits = getDigitCount(minesLeft);

    var position = digits - 1;

    docMinesLeft.width = DIGIT_WIDTH * digits;

    for (var i = 0; i < DIGITS; i++) {

        var digit = work % 10;
        work = (work - digit) / 10;

        ctxBombsLeft.drawImage(led_images[digit], DIGIT_WIDTH * position + 2, 2, DIGIT_WIDTH - 4, DIGIT_HEIGHT - 4);

        position--;
    }

}

function getDigitCount(mines) {

    var digits;
    if (mines < 1000) {
        digits = 3;
    } else if (mines < 10000) {
        digits = 4;
    } else {
        digits = 5;
    }

    return digits;
}


async function newBoardFromFile(file) {

    var fr = new FileReader();

    fr.onloadend = async function (e) {

        await newBoardFromString(e.target.result);

        showMessage("Position loaded from file " + file.name);

    };

    fr.readAsText(file);

}

async function newBoardFromString(data) {

    //console.log(data);

    var lines = data.split("\n");
    var size = lines[0].split("x");

    if (size.length != 3) {
        console.log("Header line is invalid: " + lines[0]);
        return;
    }

    var width = parseInt(size[0]);
    var height = parseInt(size[1]);
    var mines = parseInt(size[2]);

    console.log("width " + width + " height " + height + " mines " + mines);

    if (width < 1 || height < 1 || mines < 1) {
        console.log("Invalid dimensions for game");
        return;
    }

    if (lines.length < height + 1) {
        console.log("Insufficient lines to hold the data: " + lines.length);
        return;
    }

    var newBoard = new Board(1, width, height, mines, "", "safe");

    for (var y = 0; y < height; y++) {
        var line = lines[y + 1];
        console.log(line);
        for (var x = 0; x < width; x++) {

            var char = line.charAt(x);
            var tile = newBoard.getTileXY(x, y);

            if (char == "F") {
                tile.toggleFlag();
                newBoard.bombs_left--;
            } else if (char == "0") {
                tile.setValue(0);
            } else if (char == "1") {
                tile.setValue(1);
            } else if (char == "2") {
                tile.setValue(2);
            } else if (char == "3") {
                tile.setValue(3);
            } else if (char == "4") {
                tile.setValue(4);
            } else if (char == "5") {
                tile.setValue(5);
            } else if (char == "6") {
                tile.setValue(6);
            } else if (char == "7") {
                tile.setValue(7);
            } else if (char == "8") {
                tile.setValue(8);
            } else {
                tile.setCovered(true);
            }
        }
    }

    // switch to the board
    board = newBoard;

    resizeCanvas(board.width, board.height);  // resize the canvas

    browserResized();  // do we need scroll bars?

    renderTiles(board.tiles); // draw the board

    updateMineCount(board.bombs_left);

    canvasLocked = false;  // just in case it was still locked (after an error for example)

}


 // make the canvases large enough to fit the game
function resizeCanvas(width, height) {

    var boardWidth = width * TILE_SIZE;
    var boardHeight = height * TILE_SIZE;

    canvas.width = boardWidth;
    canvas.height = boardHeight;

    canvasHints.width = boardWidth;
    canvasHints.height = boardHeight;

}

function browserResized() {

    var boardElement = document.getElementById('board');

    var boardWidth = board.width * TILE_SIZE;
    var boardHeight = board.height * TILE_SIZE;

    var screenWidth = document.getElementById('canvas').offsetWidth;
    var screenHeight = document.getElementById('canvas').offsetHeight - 30;   // subtract some space to allow for the mine count panel

    console.log("Available size is " + screenWidth + " x " + screenHeight);

    // decide screen size and set scroll bars
    if (boardWidth > screenWidth && boardHeight > screenHeight) {  // both need scroll bars
        var useWidth = screenWidth;
        var useHeight = screenHeight;
        boardElement.style.overflowX = "scroll";
        boardElement.style.overflowY = "scroll";

        var scrollbarYWidth = 0;    
        var scrollbarXHeight = 0;

    } else if (boardWidth > screenWidth) {  // need a scroll bar on the bottom
        var useWidth = screenWidth;
        boardElement.style.overflowX = "scroll";

        var scrollbarXHeight = boardElement.offsetHeight - boardElement.clientHeight - 10;
        var scrollbarYWidth = 0;

        if (boardHeight + scrollbarXHeight > screenHeight) {  // the scroll bar has made the height to large now !
            var useHeight = screenHeight;
            boardElement.style.overflowY = "scroll";
            var scrollbarXHeight = 0;
        } else {
            var useHeight = boardHeight;
            boardElement.style.overflowY = "hidden";
        }

    } else if (boardHeight > screenHeight) {  // need a scroll bar on the right
        var useHeight = screenHeight;
        boardElement.style.overflowY = "scroll";

        var scrollbarYWidth = boardElement.offsetWidth - boardElement.clientWidth;
        var scrollbarXHeight = 0;

        if (boardWidth + scrollbarYWidth > screenWidth) {  // the scroll bar has made the width to large now !
            var useWidth = screenWidth;
            var scrollbarYWidth = 0;
            boardElement.style.overflowX = "scroll";
        } else {
            var useWidth = boardWidth;
            boardElement.style.overflowX = "hidden";
        }

    } else {
        var useWidth = boardWidth;
        boardElement.style.overflowX = "hidden";
        var useHeight = boardHeight;
        boardElement.style.overflowY = "hidden";
        var scrollbarYWidth = 0;
        var scrollbarXHeight = 0;
    }

    //console.log("Usable size is " + useWidth + " x " + useHeight);
    //console.log("Scroll bar Y width  " + scrollbarYWidth);
    //console.log("Scroll bar X Height  " + scrollbarXHeight);

    // change the size of the viewable frame
    boardElement.style.width = (useWidth + scrollbarYWidth) + "px";
    boardElement.style.height = (useHeight + scrollbarXHeight) + "px";

    document.getElementById("display").style.width = (useWidth + scrollbarYWidth) + "px";

}

function keyPressedEvent(e) {

    //console.log("Key pressed: " + e.key);
    var newValue = null;

    if (e.key == 'l') {   // 'L'
        lockMineCount.checked = !lockMineCount.checked;
    } else if (e.key == '0') {
        newValue = 0;
    } else if (e.key == '1') {  // '1'
        newValue = 1;
    } else if (e.key == '2') {
        newValue = 2;
    } else if (e.key == '3') {
        newValue = 3;
    } else if (e.key == '4') {
        newValue = 4;
    } else if (e.key == '5') {
        newValue = 5;
    } else if (e.key == '6') {
        newValue = 6;
    } else if (e.key == '7') {
        newValue = 7;
    } else if (e.key == '8') {
        newValue = 8;
    } else if (e.key == 'h') {
        var tile = hoverTile;
        tile.setCovered(true);
        window.requestAnimationFrame(() => renderTiles([tile]));
    } else if (e.key == 'f') {
        var tile = hoverTile;
        var tilesToUpdate = analysis_toggle_flag(tile);
        window.requestAnimationFrame(() => renderTiles(tilesToUpdate));
    } else if (e.key == 'v' && e.ctrlKey) {
        //console.log("Control-V pressed");
        navigator.clipboard.readText().then(
            clipText => newBoardFromString(clipText));
    }
    

    if (newValue == null) {
        return;
    }

    var tile = hoverTile;

    console.log('tile is' + tile);
    // can't replace a flag
    if (tile == null || tile.isFlagged()) {
        return;
    }

    var flagCount = board.adjacentFoundMineCount(tile);
    var covered = board.adjacentCoveredCount(tile);

    // check it is a legal value
    if (newValue < flagCount || newValue > flagCount + covered) {
        return;
    }

    tile.setValue(newValue);

    // update the graphical board
    window.requestAnimationFrame(() => renderTiles([tile]));

}

async function sleep(msec) {
    return new Promise(resolve => setTimeout(resolve, msec));
}


// draw a tile to the canvas
function draw(x, y, tileType) {

    //console.log('Drawing image...');

    if (tileType == BOMB) {
        ctx.drawImage(images[0], x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);  // before we draw the bomb depress the square
    }


    ctx.drawImage(images[tileType], x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

}


async function bulkRun() {

    const startTime = Date.now();

    let played = 0;
    let won = 0;
    let noGuess = 0;

    const batchSeed = runSeed.value;

    const rng = JSF(batchSeed);  // create an RNG based on the seed
    const startIndex = 0;

    const size = parseInt(runGames.value)

    const board1 = runBoard.value.toUpperCase().split("/");

    if (board1.length != 2) {
        console.log("Board size not interpretable expecting WidthxHeight/Mines");
        return;
    }

    const mines = parseInt(board1[1]);

    const board2 = board1[0].split("X");

    if (board2.length != 2) {
        console.log("Board size not interpretable expecting WidthxHeight/Mines");
        return;
    }

    const width = parseInt(board2[0]);
    const height = parseInt(board2[1]);

    {
        board = new Board(0, width, height, mines, 0, "safe");

        resizeCanvas(board.width, board.height);  // resize the canvas

        browserResized();  // do we need scroll bars?

        renderTiles(board.tiles); // draw the board

        updateMineCount(board.bombs_left);

    }

    const options = {};
    options.allowDeadTileAnalysis = runDeadTileAnalysis.checked;
    options.allowTieBreak = runTieBreak.checked;
    options.allow5050Check = run5050Check.checked;
    options.bruteForceThreshold = parseInt(runBFDAThreshold.value);
    options.verbose = false;

    while (played < size) {

        played++;

        const gameSeed = Math.floor(rng() * Number.MAX_SAFE_INTEGER);

        console.log(gameSeed);

        const game = new ServerGame(0, width, height, mines, startIndex, gameSeed, "safe");

        const board = new Board(0, width, height, mines, gameSeed, "safe");

        let tile = game.getTile(startIndex);

        let revealedTiles = game.clickTile(tile);
        applyResults(board, revealedTiles);  // this is in MinesweeperGame.js

        let loopCheck = 0;
        let guessed = false;
        while (revealedTiles.header.status == IN_PLAY) {

            loopCheck++;

            if (loopCheck > 10000) {
                break;
            }

            const reply = await solve(board, options, true);

            if (!reply.valid) {
                console.log("Reply not valid: " + reply.message);
                return;
            }

            const actions = reply.tiles;

            // build a list of actions to play
            const toPlay = [];
            for (const action of actions) {
                if (action.safety == 1 || action.play != null) {   // if safe to clear  or the best guess
                    toPlay.push(action);

                    if (action.safety != 1) {  // do no more actions after a guess
                        guessed = true;
                        break;
                    }
                }
            }

            // if nothing to play make the first not dead guess
            if (toPlay.length == 0) {
                guessed = true;
                for (const action of actions) {
                    if (action.dead == null && action.safety > 0) {   // if not dead and not a mine
                        toPlay.push(action);
                        break;
                    }
                }
            }

            // if still nothing to play make the first guess
            if (toPlay.length == 0) {
                toPlay.push(actions[0]);
            }

            for (const action of toPlay) {

                tile = game.getTile(board.xy_to_index(action.x, action.y));

                revealedTiles = game.clickTile(tile);

                if (revealedTiles.header.status != IN_PLAY) {  // if won or lost nothing more to do
                    if (action.safety == 0) {
                        console.log("clicked on a known mine!");
                        console.log(action);
                        return;
                    }
                    if (action.safety == 1 && revealedTiles.header.status == LOST) {
                        console.log("Died with a safety of 1 !! ");
                        console.log(action);
                        return;
                    }
                    break;
                }

                applyResults(board, revealedTiles);

             }

        }

        console.log(revealedTiles.header.status);

        if (revealedTiles.header.status == WON) {
            won++;
            if (!guessed) {
                noGuess++
            }
        }

        const output = "Played " + played + " won " + won + " (" + (100 * won / played).toFixed(2) + "%) No guess " + noGuess;

        runOutput.innerHTML = output;

        console.log(output);
    }

    const output = "Seed " + batchSeed + " Finished ==> Played " + played + " won " + won + " (" + (100 * won / played).toFixed(2) + "%) No guess " + noGuess;

    runOutput.innerHTML = output;

    console.log(output);



}

function applyResults(board, revealedTiles) {

    //console.log("Tiles to reveal " + revealedTiles.tiles.length);
    //console.log(revealedTiles);

    // apply the changes to the logical board
    for (let i = 0; i < revealedTiles.tiles.length; i++) {

        const target = revealedTiles.tiles[i];

        const index = target.index;
        const action = target.action;

        const tile = board.getTile(index);

        if (action == 1) {    // reveal value on tile
            tile.setValue(target.value);
            //console.log("Setting Tile " + target.index + " to " + target.value);

        } else if (action == 2) {  // add or remove flag
            if (target.flag != tile.isFlagged()) {
                tile.toggleFlag();
                if (tile.isFlagged()) {
                    board.bombs_left--;
                } else {
                    board.bombs_left++;
                }
            }

        } else if (action == 3) {  // a tile which is a mine (these get returned when the game is lost)
            board.setGameLost();
            tile.setBomb(true);

        } else if (action == 4) {  // a tile which is a mine and is the cause of losing the game
            board.setGameLost();
            tile.setBombExploded();

        } else if (action == 5) {  // a which is flagged but shouldn't be
            tile.setBomb(false);

        } else {
            console.log("action " + action + " is not valid");
        }

    }

}

// reads a file dropped onto the top of the minesweeper board
async function dropHandler(ev) {
    console.log('File(s) dropped');

    // Prevent default behavior (Prevent file from being opened)
    ev.preventDefault();

    if (ev.dataTransfer.items) {
        console.log("Using Items Data Transfer interface");
        // Use DataTransferItemList interface to access the file(s)
        for (var i = 0; i < ev.dataTransfer.items.length; i++) {
            // If dropped items aren't files, reject them
            if (ev.dataTransfer.items[i].kind === 'file') {
                var file = ev.dataTransfer.items[i].getAsFile();
                console.log('... file[' + i + '].name = ' + file.name);

                newBoardFromFile(file);
                break; // only process the first one
  
            }
        }
    } else {
        // Use DataTransfer interface to access the file(s)
        console.log("File Transfer Interface not supported");
        for (var i = 0; i < ev.dataTransfer.files.length; i++) {
            console.log('... file[' + i + '].name = ' + ev.dataTransfer.files[i].name);
        }
    }
}

// Prevent default behavior (Prevent file from being opened)
function dragOverHandler(ev) {
    //console.log('File(s) in drop zone');
    ev.preventDefault();
}

// load an image 
function load_image(image_path) {
    var image = new Image();
    image.addEventListener('load', function () {

        console.log("An image has loaded: " + image_path);
        imagesLoaded++;
        if (imagesLoaded == images.length + led_images.length) {
            startup();
        }

    }, false);
    image.src = image_path;
    return image;
}

function load_images() {

    console.log('Loading images...');

    for (var i = 0; i <= 8; i++) {
        var file_path = "resources/images/" + i.toString() + ".png";
        images.push(load_image(file_path));
        var led_path = "resources/images/led" + i.toString() + ".svg";
        led_images.push(load_image(led_path));
    }

    led_images.push(load_image("resources/images/led9.svg"));

    images.push(load_image("resources/images/bomb.png"));
    images.push(load_image("resources/images/facingDown.png"));
    images.push(load_image("resources/images/flagged.png"));
    images.push(load_image("resources/images/flaggedWrong.png"));
    images.push(load_image("resources/images/exploded.png"));

    console.log(images.length + ' Images Loaded');

}

function showMessage(text) {
    /*
    messageLine.innerText = text;
    messageLine.innerHTML = text;
    */
}