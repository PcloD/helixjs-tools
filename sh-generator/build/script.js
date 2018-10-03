(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory() :
	typeof define === 'function' && define.amd ? define('HX', factory) :
	(factory());
}(this, (function () { 'use strict';

	class HDR
	{
		constructor(data)
		{
			this.data = null;
			this.width = 0;
			this.height = 0;

			this._dataView = new DataView(data);
			this._exposure = 1;
			this._colorCorr = [1 ,1 , 1];
			this._offset = 0;

			this._parseHeader();
			this._parseData();
			this._dataView = null;
		}

		_parseHeader()
		{
			let line = this._readLine();
			if (line !== "#?RADIANCE" && line !== "#?RGBE")
				throw new Error("Incorrect file format!");

			while (line !== "") {
				// empty line means there's only 1 line left, containing size info:
				line = this._readLine();
				let parts = line.split("=");
				switch (parts[0]) {
					case "GAMMA":
						this._gamma = parseFloat(parts[1]);
						break;
					case "FORMAT":
						if (parts[1] !== "32-bit_rle_rgbe" && parts[1] !== "32-bit_rle_xyze")
							throw new Error("Incorrect encoding format!");
						break;
					case "EXPOSURE":
						this._exposure *= parseFloat(parts[1]);
						break;
					case "COLORCORR":
						this._colorCorr = parts[1].replace(/^\s+|\s+$/g, "").split(" ");
						break;
				}
			}

			line = this._readLine();
			let parts = line.split(" ");
			this._parseSize(parts[0], parseInt(parts[1]));
			this._parseSize(parts[2], parseInt(parts[3]));
		}

		_parseSize(label, value)
		{
			switch(label) {
				case "+X":
					this.width = value;
					break;
				case "-X":
					this.width = value;
					console.warn("Flipping horizontal orientation not currently supported");
					break;
				case "-Y":
					this.height = value;
					break;
				case "+Y":
					this.height = value;
					console.warn("Flipping vertical orientation not currently supported");
					break;
			}
		}

		_readLine()
		{
			let ch, str = "";
			while ((ch = this._dataView.getUint8(this._offset++)) !== 0x0a) {
				str += String.fromCharCode(ch);
			}
			return str;
		}

		_parseData()
		{
			let hash = this._dataView.getUint16(this._offset);
			if (hash === 0x0202)
				this.data = this._parseNewRLE();
			else {
				throw new Error("Obsolete HDR file version!");
			}
		}

		_parseNewRLE()
		{
			let numPixels = this.width * this.height;
			let w = this.width;
			let data = new Float32Array(numPixels * 3);
			let i = 0;
			let offset = this._offset;

			for (let y = 0; y < this.height; ++y) {
				if (this._dataView.getUint16(offset) !== 0x0202)
					throw new Error("Incorrect scanline start hash");

				if (this._dataView.getUint16(offset + 2) !== this.width)
					throw new Error("Scanline doesn't match picture dimension!");

				offset += 4;
				let numComps = w * 4;

				// read individual RLE components
				let comps = [];
				let x = 0;

				while (x < numComps) {
					let value = this._dataView.getUint8(offset++);
					if (value > 128) {
						// RLE:
						let len = value - 128;
						value = this._dataView.getUint8(offset++);
						for (let rle = 0; rle < len; ++rle) {
							comps[x++] = value;
						}
					}
					else {
						for (let n = 0; n < value; ++n) {
							comps[x++] = this._dataView.getUint8(offset++);
						}
					}
				}

				for (x = 0; x < w; ++x) {
					let r = comps[x];
					let g = comps[x + w];
					let b = comps[x + w * 2];
					let e = comps[x + w * 3];

					// NOT -128 but -136!!! This allows encoding smaller values rather than higher ones (as you'd expect).
					e = e? Math.pow(2.0, e - 136) : 0;

					data[i++] = r * e * this._exposure * this._colorCorr[0];
					data[i++] = g * e * this._exposure * this._colorCorr[1];
					data[i++] = b * e * this._exposure * this._colorCorr[2];
				}
			}

			return data;
		}
	}

	// https://en.wikipedia.org/wiki/Table_of_spherical_harmonics#Real_spherical_harmonics
	const l0 = 0.5 * Math.sqrt(1.0 / Math.PI);
	const l1 = 0.5 * Math.sqrt(3.0 / Math.PI);
	const l2_1 = 0.5 * Math.sqrt(15.0 / Math.PI);
	const l2_2 = 0.25 * Math.sqrt(5.0 / Math.PI);
	const l2_3 = 0.25 * Math.sqrt(15.0 / Math.PI);

	let sh = [];

	const irrConstants = [
		Math.PI,
		Math.PI * 2 / 3,
		Math.PI * 2 / 3,
		Math.PI * 2 / 3,
		Math.PI / 4,
		Math.PI / 4,
		Math.PI / 4,
		Math.PI / 4,
		Math.PI / 4
	];

	const shConstants = [
		l0,

		l1,
		l1,
		l1,

		l2_1,
		l2_1,
		l2_2,
		l2_1,
		l2_3
	];

	class SHGenerator
	{
		constructor()
		{
			this._p = 0;
			this._len = 0;
			this._sh = null;
			this.onComplete = null;
			this.onProgress = null;
			this.irradiance = true;
			this._doPart = this._doPart.bind(this);
			this._finish = this._finish.bind(this);
		}

		generate(image)
		{
			this._sh = [];
			for (let i = 0; i < 9; ++i)
				this._sh[i] = {r: 0, g: 0, b: 0};

			this._p = 0;
			this._width = image.width;
			this._height = image.height;
			this._data = image.data;
			this._numSamples = image.width * image.height;
			this._totalWeight = 0;
			this._doPart();
		}

		_doPart()
		{
			for (let i = 0; i < 10000; ++i) {
				let x = this._p % this._width;
				let y = Math.floor(this._p / this._width);
				let p3 = this._p * 3;
				this._accumulate(x, y, this._data[p3], this._data[p3 + 1], this._data[p3 + 2]);

				if (++this._p === this._numSamples) {
					setTimeout(this._finish, 0);
					return;
				}
			}

			if (this.onProgress)
				this.onProgress(this._p / this._numSamples);

			setTimeout(this._doPart, 0);
		}

		_accumulate(x, y, r, g, b)
		{
			// + .5 to match helix's panorama orientation
			let u = -(x / this._width * 2.0 - 1.0) + .5;
			let v = y / this._height * 2.0 - 1.0;
			let phi = v * Math.PI / 2;
			let cosPhi = Math.cos(phi);
			let nx = Math.cos(u * Math.PI) * cosPhi;
			let ny = -Math.sin(phi);
			let nz = Math.sin(u * Math.PI) * cosPhi;

			sh[0] = shConstants[0];

			sh[1] = shConstants[1] * ny;
			sh[2] = shConstants[2] * nz;
			sh[3] = shConstants[3] * nx;

			sh[4] = shConstants[4] * nx * ny;
			sh[5] = shConstants[5] * ny * nz;
			sh[6] = shConstants[6] * (3.0 * nz * nz - 1.0);
			sh[7] = shConstants[7] * nz * nx;
			sh[8] = shConstants[8] * (nx * nx - ny * ny);

			let w = cosPhi;	// cos(phi) is the differential solid angle
			this._totalWeight += w;

			for (let i = 0; i < 9; ++i) {
				let v = this._sh[i];
				v.r += sh[i] * r * w;
				v.g += sh[i] * g * w;
				v.b += sh[i] * b * w;
			}
		}

		_finish()
		{
			for (let i = 0; i < 9; ++i) {
				let sc = this.irradiance? irrConstants[i] : 1.0;
				sc *= Math.PI * 4.0 / this._totalWeight;
				let sh = this._sh[i];
				sh.r *= sc;
				sh.g *= sc;
				sh.b *= sc;
			}

			if (this.onProgress)
				this.onProgress(1);

			if (this.onComplete)
				this.onComplete(this._sh);
		}
	}

	var commonjsGlobal = typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

	/*
	* FileSaver.js
	* A saveAs() FileSaver implementation.
	*
	* By Eli Grey, http://eligrey.com
	*
	* License : https://github.com/eligrey/FileSaver.js/blob/master/LICENSE.md (MIT)
	* source  : http://purl.eligrey.com/github/FileSaver.js
	*/


	// The one and only way of getting global scope in all enviorment
	// https://stackoverflow.com/q/3277182/1008999
	var _global = (function () {
	// some use content security policy to disable eval
	  try {
	    return Function('return this')() || (0, eval)('this')
	  } catch (e) {
	    // every global should have circular reference
	    // used for checking if someone writes var window = {}; var self = {}
	    return typeof window === 'object' && window.window === window ? window
	    : typeof self === 'object' && self.self === self ? self
	    : typeof commonjsGlobal === 'object' && commonjsGlobal.global === commonjsGlobal ? commonjsGlobal : this
	  }
	})();

	function bom (blob, opts) {
	  if (typeof opts === 'undefined') opts = { autoBom: false };
	  else if (typeof opts !== 'object') {
	    console.warn('Depricated: Expected third argument to be a object');
	    opts = { autoBom: !opts };
	  }

	  // prepend BOM for UTF-8 XML and text/* types (including HTML)
	  // note: your browser will automatically convert UTF-16 U+FEFF to EF BB BF
	  if (opts.autoBom && /^\s*(?:text\/\S*|application\/xml|\S*\/\S*\+xml)\s*;.*charset\s*=\s*utf-8/i.test(blob.type)) {
	    return new Blob([String.fromCharCode(0xFEFF), blob], { type: blob.type })
	  }
	  return blob
	}

	function download (url, name, opts) {
	  var xhr = new XMLHttpRequest();
	  xhr.open('GET', url);
	  xhr.responseType = 'blob';
	  xhr.onload = function () {
	    saveAs(xhr.response, name, opts);
	  };
	  xhr.onerror = function () {
	    console.error('could not download file');
	  };
	  xhr.send();
	}

	function corsEnabled (url) {
	  var xhr = new XMLHttpRequest();
	  // use sync to avoid popup blocker
	  xhr.open('HEAD', url, false);
	  xhr.send();
	  return xhr.status >= 200 && xhr.status <= 299
	}

	// `a.click()` don't work for all browsers (#465)
	function click(node) {
	  try {
	    node.dispatchEvent(new MouseEvent('click'));
	  } catch (e) {
	    var evt = document.createEvent('MouseEvents');
	    evt.initMouseEvent('click', true, true, window, 0, 0, 0, 80,
	                          20, false, false, false, false, 0, null);
	    node.dispatchEvent(evt);
	  }
	}

	var saveAs = _global.saveAs ||
	// probably in some web worker
	(typeof window !== 'object' || window !== _global)
	  ? function saveAs () { /* noop */ }

	// Use download attribute first if possible (#193 Lumia mobile)
	: 'download' in HTMLAnchorElement.prototype
	? function saveAs (blob, name, opts) {
	  var URL = _global.URL || _global.webkitURL;
	  var a = document.createElement('a');
	  name = name || blob.name || 'download';

	  a.download = name;
	  a.rel = 'noopener'; // tabnabbing

	  // TODO: detect chrome extensions & packaged apps
	  // a.target = '_blank'

	  if (typeof blob === 'string') {
	    // Support regular links
	    a.href = blob;
	    if (a.origin !== location.origin) {
	      corsEnabled(a.href)
	        ? download(blob, name, opts)
	        : click(a, a.target = '_blank');
	    } else {
	      click(a);
	    }
	  } else {
	    // Support blobs
	    a.href = URL.createObjectURL(blob);
	    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4E4); // 40s
	    setTimeout(function () { click(a); }, 0);
	  }
	}

	// Use msSaveOrOpenBlob as a second approch
	: 'msSaveOrOpenBlob' in navigator
	? function saveAs (blob, name, opts) {
	  name = name || blob.name || 'download';

	  if (typeof blob === 'string') {
	    if (corsEnabled(blob)) {
	      download(blob, name, opts);
	    } else {
	      var a = document.createElement('a');
	      a.href = blob;
	      a.target = '_blank';
	      setTimeout(function () { clikc(a); });
	    }
	  } else {
	    navigator.msSaveOrOpenBlob(bom(blob, opts), name);
	  }
	}

	// Fallback to using FileReader and a popup
	: function saveAs (blob, name, opts, popup) {
	  // Open a popup immediately do go around popup blocker
	  // Mostly only avalible on user interaction and the fileReader is async so...
	  popup = popup || open('', '_blank');
	  if (popup) {
	    popup.document.title =
	    popup.document.body.innerText = 'downloading...';
	  }

	  if (typeof blob === 'string') return download(blob, name, opts)

	  var force = blob.type === 'application/octet-stream';
	  var isSafari = /constructor/i.test(_global.HTMLElement) || _global.safari;
	  var isChromeIOS = /CriOS\/[\d]+/.test(navigator.userAgent);

	  if ((isChromeIOS || (force && isSafari)) && typeof FileReader === 'object') {
	    // Safari doesn't allow downloading of blob urls
	    var reader = new FileReader();
	    reader.onloadend = function () {
	      var url = reader.result;
	      url = isChromeIOS ? url : url.replace(/^data:[^;]*;/, 'data:attachment/file;');
	      if (popup) popup.location.href = url;
	      else location = url;
	      popup = null; // reverse-tabnabbing #460
	    };
	    reader.readAsDataURL(blob);
	  } else {
	    var URL = _global.URL || _global.webkitURL;
	    var url = URL.createObjectURL(blob);
	    if (popup) popup.location = url;
	    else location.href = url;
	    popup = null; // reverse-tabnabbing #460
	    setTimeout(function () { URL.revokeObjectURL(url); }, 4E4); // 40s
	  }
	};

	var FileSaver = _global.saveAs = saveAs.saveAs = saveAs;

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
					processFile(file);
				}
			}
		} else {
			// Use DataTransfer interface to access the file(s)
			for (let i = 0; i < event.dataTransfer.files.length; i++) {
				processFile(event.dataTransfer.files[i]);
			}
		}
	}

	function processFile(file)
	{
		document.getElementById("errorContainer").classList.add("hidden");
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
		let hdr;
		try {
			hdr = new HDR(data);
		}
		catch(err) {
			showError(err.message);
		}

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
		FileSaver(blob, "sh.ash");
	}

	function showError(message)
	{
		document.getElementById("errorContainer").classList.remove("hidden");
		document.getElementById("startContainer").classList.add("hidden");
		document.getElementById("endContainer").classList.add("hidden");
		document.getElementById("progress").classList.add("hidden");
		document.getElementById("errorMessage").innerHTML = message;
	}

})));
