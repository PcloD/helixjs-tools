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

export class SHGenerator
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