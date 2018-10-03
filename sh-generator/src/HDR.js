export class HDR
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