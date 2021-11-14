
"use strict";

console.log('At start of main.js');

var TILE_SIZE = 24;
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

var canvas = document.getElementById('myCanvas');
var ctx = canvas.getContext('2d');

var docMinesLeft = document.getElementById('myMinesLeft');
var ctxBombsLeft = docMinesLeft.getContext('2d');

var canvasHints = document.getElementById('myHints');
var ctxHints = canvasHints.getContext('2d');

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

    //renderHints([]);  // clear down hints

    renderTiles(board.tiles); // draw the board

    updateMineCount(board.bombs_left);  // reset the mine count

    showMessage("Welcome to minesweeper solver dedicated to Annie");
}

async function solve() {

    var message = {};

    // create the board dimensions
    var mb = {};
    mb.width = board.width;
    mb.height = board.height;
    mb.mines = board.num_bombs;

    // create the tile details for revealed tiles
    var tiles = [];
    for (var tile of board.tiles) {

        if (!tile.isCovered()) {
            var t = {};
            t.x = tile.x;
            t.y = tile.y;
            t.value = tile.getValue();
            tiles.push(t);
        } 

    }

    message.board = mb;
    message.tiles = tiles;

    var outbound = JSON.stringify(message);
    console.log("==> " + outbound);

    var json_data = await fetch("/solve", {
        method: "POST",
        body: outbound,
        headers: new Headers({
            "Content-Type": "application/json"
        })
    });
    var reply = await json_data.json();


    console.log("<== " + JSON.stringify(reply));

    if (reply.valid) {
        renderHints(reply.tiles);
    }

}

// render an array of tiles to the canvas
function renderHints(hints) {

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
        var value = (1 - tile.safety) * 100;
  
        if (value < 10) {
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