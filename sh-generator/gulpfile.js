var gulp = require('gulp');
var uglify = require('gulp-uglify');
var rollup = require('gulp-better-rollup');
var rename = require('gulp-rename');
var commonjs = require("rollup-plugin-commonjs");
var nodeResolve = require("rollup-plugin-node-resolve");

gulp.task('default', ['minimize', 'copyweb']);

gulp.task('build', function ()
{
	return gulp.src(['./src/main.js'])
		.pipe(rollup(
			{
				plugins: [
					nodeResolve({
						jsnext: true,
						main: true
					}),
					commonjs({
						include: 'node_modules/**'
					})
				]
			},
			{
				name: 'HX',
				format: 'umd'
			}
		))
		.pipe(rename('script.js'))
		.pipe(gulp.dest('./build/'));
});


gulp.task('minimize', ['build'], function ()
{
	gulp.src(['./build/helix.js', './build/helix-io.js', './build/helix-physics.js'], {base: './build/'})
		.pipe(uglify())
		.pipe(rename({suffix: '.min'}))
		.pipe(gulp.dest('./build/'));
});

gulp.task('copyweb', function() {
	return gulp.src(['./web/**/*.*'])
		.pipe(gulp.dest('./build'));
});
