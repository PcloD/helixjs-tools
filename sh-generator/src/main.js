import {HDR} from "./HDR";
import {SHGenerator} from "./SHGenerator";
import saveAs from "file-saver";

let ashContents = null;

window.addEventListener("load", init);

function init()
{
	document.body.addEventListener("drop", onDrop);
	document.body.addEventListener("dragover", onDragOver);
	document.getElementById("downloadButton").addEventListener("click", onDownloadClick);
}

function onDragOver(event)
{
	event.preventDefault();
}

function onDrop(event)
{
	event.preventDefault();

	if (event.dataTransfer.items) {
		// Use DataTransferItemList interface to access the file(s)
		for (let i = 0; i < event.dataTransfer.items.length; i++) {
			// If dropped items aren't files, reject them
			if (event.dataTransfer.items[i].kind === 'file') {
				let file = event.dataTransfer.items[i].getAsFile();
				processFile(file)
			}
		}
	} else {
		// Use DataTransfer interface to access the file(s)
		for (let i = 0; i < event.dataTransfer.files.length; i++) {
			processFile(event.dataTransfer.files[i])
		}
	}
}

function processFile(file)
{
	document.getElementById("startContainer").classList.add("hidden");
	document.getElementById("endContainer").classList.add("hidden");
	document.getElementById("progress").classList.remove("hidden");

	let fileReader = new FileReader();
	fileReader.onload = function(event) {
		processHDR(event.target.result);
	};
	fileReader.readAsArrayBuffer(file);
}

function processHDR(data)
{
	let hdr = new HDR(data);
	let generator = new SHGenerator();
	generator.onComplete = onComplete;
	generator.onProgress = onProgress;
	generator.irradiance = document.getElementById("irradianceCheck").checked;
	generator.generate(hdr);
}

function onProgress(ratio)
{
	let progress = document.getElementById("progressProgress");
	progress.style.width = Math.floor(ratio * 100) + "%";
}

function onComplete(sh)
{
	document.getElementById("progress").classList.add("hidden");
	document.getElementById("endContainer").classList.remove("hidden");

	let str = "# Generated with Helix\n";

	let n = 0;
	for (let l = 0; l < 3; ++l) {
		str += "\nl=" + l + ":\n" ;
		for (let m = -l; m <= l; ++m) {
			str += "m=" + m + ": ";
			str += sh[n].r + " " + sh[n].g + " " + sh[n].b + "\n";
			++n;
		}
	}

	ashContents = str;
}

function onDownloadClick()
{
	var blob = new Blob([ashContents], {type: "text/plain;charset=utf-8"});
	saveAs(blob, "sh.ash");
}