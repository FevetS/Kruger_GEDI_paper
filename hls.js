// Prepare HLS L30 and S2 and combine to form a makeshift HLS product
// This is in lieu of HLS S30 until it is ingested by Google
var gen = require('users/jcvogeler/VogelerLab:Modules/general.js');

///////////////////////////////////////////////////////
//Function to simplify data into daily mosaics
//This procedure must be used for proper processing of S2 imagery
// Taken from: https://github.com/rcr-usfs/gtac-rcr-gee-js-modules/blob/master/getImagesLib.js
var dailyMosaics = function(imgs) {
  //Simplify date to exclude time of day
  imgs = imgs.map(function (img) {
    var d = ee.String(img.date().format("YYYY-MM-dd"));
    var orbit = ee.Number(img.get("SENSING_ORBIT_NUMBER")).int16().format();
    return img.set({ "date-orbit": d.cat(ee.String("_")).cat(orbit), date: d });
  });

  //Find the unique days
  var dayOrbits = ee.Dictionary(imgs.aggregate_histogram("date-orbit")).keys();
  // print("Day-Orbits:", dayOrbits);

  function getMosaic(d) {
    var date = ee.Date(ee.String(d).split("_").get(0));
    var orbit = ee.Number.parse(ee.String(d).split("_").get(1));

    var t = imgs.filterDate(date, date.advance(1, "day")).filter(ee.Filter.eq("SENSING_ORBIT_NUMBER", orbit));

    var f = ee.Image(t.first());
    t = t.mosaic();
    t = t.set("system:time_start", date.millis());
    t = t.copyProperties(f);
    return t;
  }

  imgs = dayOrbits.map(getMosaic);
  imgs = ee.ImageCollection.fromImages(imgs);
  // print("N s2 mosaics:", imgs.size());
  return imgs;
};


// Method for daily mosaics taken from - https://code.earthengine.google.com/ec5f79e5bd195ec0da0ddbdc2cd11088
// This method may be more efficient than GTAC's method (dailyMosaic) according to a brief Profiler test
var dailyMosaics2 = function(imgs){
  // set date on each image
  function set_date(img) {
    var date = img.date().format('YYYY-MM-dd'); // 
    return img.set('date', date);
  }
  imgs = imgs.map(set_date);
  
  // 'distinct' removes duplicates from a collection based on a property.
  var distinctDates_S2_sr = imgs.distinct('date').sort('date');

  // define the filter
  var filter = ee.Filter.equals({leftField: 'date', rightField: 'date'});
  
  // 'ee.Join.saveAll' Returns a join that pairs each element from the first collection with a group of matching elements from the second collection
  // the matching images are stored in a new property called 'date_match'
  var join = ee.Join.saveAll('date_match');

  // 'apply' Joins to collections.
  var joinCol_S2_sr = join.apply(distinctDates_S2_sr, imgs, filter);

  // This function mosaics image acquired on the same day (same image swath)
  var mosaic_collection = function(img){
    var orig = img;
    
    // create a collection of the date-matching images
    var col = ee.ImageCollection.fromImages(img.get('date_match')); 
    
    // extract collection properties to assign to the mosaic
    var time_start = col.aggregate_min('system:time_start');
    var time_end = col.aggregate_max('system:time_end');
    var index_list = col.aggregate_array('system:index');
    index_list = index_list.join(',');
    var scene_count = col.size();
    
    // get the unified geometry of the collection (outer boundary)
    var col_geo = col.geometry().dissolve();
    
    // clip the mosaic to set a geometry to it
    var mosaic = col.mosaic().clip(col_geo).copyProperties(img, ["system:time_start", "system:index", "date", "month", "SENSING_ORBIT_NUMBER", "PROCESSING_BASELINE", "SPACECRAFT_NAME", "MEAN_SOLAR_ZENITH_ANGLE", "MEAN_SOLAR_AZIMUTH_ANGLE"]);
    
    // set the extracted properties to the mosaic
    mosaic = mosaic.set('system:time_start', time_start)
                   .set('system:time_end', time_end)
                   .set('index_list', index_list)
                   .set('scene_count', scene_count);
    
    // // (don't think this is needed) reset the projection to epsg:32632 as mosaic changes it to epsg:4326 (otherwise the registration fails)
    // mosaic = ee.Image(mosaic).setDefaultProjection('epsg:32613', null, 10); //'epsg:32636'
    
    return mosaic;
  };
  
  imgs = ee.ImageCollection(joinCol_S2_sr.map(mosaic_collection));
  return imgs;
};

// Image prep functions for an S2 image
// (more verbose, but probably faster to split sensors than getting the coefficients from a dict based on sensor)
var s2_opt_names = ['ca', 'blue', 'green', 'red', 'nir', 'swir1', 'swir2'];
var s2a_slope = ee.Image([0.9959, 0.9778, 1.0053, 0.9765, 0.9983, 0.9987, 1.003]).float().rename(s2_opt_names);
var s2b_slope = ee.Image([0.9959, 0.9778, 1.0075, 0.9761, 0.9966, 1.000, 0.9867]).float().rename(s2_opt_names);
var s2a_offset = ee.Image([-0.0002, -0.004, -0.0009, 0.0009, -0.0001, -0.0011, -0.0012]).float().rename(s2_opt_names);
var s2b_offset = ee.Image([-0.0002, -0.004, -0.0008, 0.001, 0.000, -0.0003, 0.0004]).float().rename(s2_opt_names);

var prep_hls_s2a_img = function(img){
    var bands = ["B1", "B2", "B3", "B4", "B8A", "B11", "B12"];
    var hs = img.select(bands, s2_opt_names);
    hs = hs.multiply(0.0001).multiply(s2a_slope).add(s2a_offset);
    hs = hs.copyProperties(img)
           .set('system:time_start', img.get('system:time_start'), 
                'system:time_end', img.get('system:time_end'),
                'source', 'S2');
    return hs;
};

var prep_hls_s2b_img = function(img){
    var bands = ["B1", "B2", "B3", "B4", "B8A", "B11", "B12"];
    var hs = img.select(bands, s2_opt_names);
    hs = hs.multiply(0.0001).multiply(s2b_slope).add(s2b_offset);
    hs = hs.copyProperties(img)
           .set('system:time_start', img.get('system:time_start'), 
                'system:time_end', img.get('system:time_end'),
                'source', 'S2');
    return hs;
};


// Get an S2 collection prepped for merge with HLS L30
var get_s2_collection = function(aoi, start_date, end_date, filter, cs_thresh){
  cs_thresh = cs_thresh || 0.65; // 0.6 was preferred default
  
  // Filter
  var imgs = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(aoi)
    .filterDate(start_date, end_date);
    
  // Additional filtering by optionally provided combined filter
  if (filter !== undefined){
    imgs = imgs.filter(filter);
  }
    
  // Cloud and edge masking
  var cs = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
  imgs = imgs.linkCollection(cs, 'cs').map(function(i) {
      return i.updateMask(i.select('cs').gte(cs_thresh)) // mask clouds
              .updateMask(i.select('B8A').mask())        // mask edges of all bands to 20 m band
              .updateMask(i.select('B9').mask());        // mask edges of all bands to 60 m band
              // .updateMask(i.toArray().mask());           // alternative method to mask fringe edges. (less efficient according to brief Profiler test)
    });
  
  // Rescale and harmonize
  var s2a = imgs.filter(ee.Filter.eq('SPACECRAFT_NAME', 'Sentinel-2A')).map(prep_hls_s2a_img);
  var s2b = imgs.filter(ee.Filter.eq('SPACECRAFT_NAME', 'Sentinel-2B')).map(prep_hls_s2b_img);
  imgs = s2a.merge(s2b);

  // daily mosaics to remove duplicate observations 
  // (skipping because it's slow and leads to memory limit errors)
  // imgs = dailyMosaics(imgs);
  
  // Set mean aggregation for reprojection
  imgs = imgs.map(function(i){return i.reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 96})});
  
  return imgs;
};


var fmask = function(img, opts){
    /*
    Keep pixels which meet all the given critera, and mask out others.
    Values should match the HLS guide 
    0=='No' and 1=='Yes', null='accept either' and conf values: 0,1,2,3=='None', 'low', 'med', 'high'
    
    'Less than or equal to' operation applied to conf values. For example, 
    aerosol=2 means keep medium and low aerosol. 
    
    Defaults retain pixels with no snow, clouds, dilated clouds, or cloud shadows and low aerosol
    
    returns: ee.Image
        Mask which can be applied using ee.Image.updateMask()
    */
  
  // Set defaults and allow arguments to be set as null which accepts any value for the flag
  // opts = opts || {fill:0, clear:1, clouds:1}
  opts = opts || {}
  var cirrus = ('cirrus' in opts) ? opts['cirrus'] : 0;
  var cloud = ('cloud' in opts) ? opts['cloud'] : 0;
  var dilated_cloud = ('dilated_cloud' in opts) ? opts['dilated_cloud'] : 0;
  var shadow = ('shadow' in opts) ? opts['shadow'] : 0;
  var snow = ('snow' in opts) ? opts['snow'] : 0;
  var water = ('water' in opts) ? opts['water'] : null;
  var aerosol = ('aerosol' in opts) ? opts['aerosol'] : 2; // HLS docs recommend masking high aerosol
    
  var fmask = img.select('Fmask');
  
  var mask = img.mask(); // use existing mask or ee.Image(1)?
  mask = (cirrus===null) ? mask : mask.and(fmask.bitwiseAnd(1).eq(cirrus));
  mask = (cloud===null) ? mask : mask.and(fmask.bitwiseAnd(1<<1).eq(cloud<<1));
  mask = (dilated_cloud===null) ? mask : mask.and(fmask.bitwiseAnd(1<<2).eq(dilated_cloud<<2));
  mask = (shadow===null) ? mask : mask.and(fmask.bitwiseAnd(1<<3).eq(shadow<<3));
  mask = (snow===null) ? mask :  mask.and(fmask.bitwiseAnd(1<<4).eq(snow<<4));
  mask = (water===null) ? mask : mask.and(fmask.bitwiseAnd(1<<5).eq(water<<5));
  mask = (aerosol===null) ? mask : mask.and(fmask.bitwiseAnd(3<<6).lte(aerosol<<6));
  
  return mask;
};


// Get L30 collection
var get_l30_collection = function(aoi, start_date, end_date, filter, fmask_opts){
  // Get initial collection
  var imgs = ee.ImageCollection("NASA/HLS/HLSL30/v002")
    .filterBounds(aoi)
    .filterDate(start_date, end_date);
    
  // Additional filtering by optionally provided combined filter
  if (filter !== undefined){
    imgs = imgs.filter(filter);
  }
    
  // Cloud masking
  imgs = imgs.map(function(i){return i.updateMask(fmask(i, fmask_opts))});
  
  // Get NBAR bands and set resampling. GEE collection is already scaled 0-1.
  var bands = ["B1", "B2", "B3", "B4", "B5", "B6", "B7"];
  var l30_opt_names = ['ca', 'blue', 'green', 'red', 'nir', 'swir1', 'swir2'];
  imgs = imgs.select(bands, l30_opt_names);
  
  // Set resampling to bilinear
  imgs = imgs.map(function(i){return i.toFloat().set('source', 'L30').resample('bilinear')});
  
  // skipping daily mosaics to remove duplicate observations 
  // (this is slow and leads to memory limit errors)
  // imgs = dailyMosaics(imgs);
  
  return imgs;
};


// Get both collections and merge
var get_hls_collection = function(aoi, start_date, end_date, l30_filter, s2_filter, fmask_opts, cs_thresh){
  var l30 = get_l30_collection(aoi, start_date, end_date, l30_filter, fmask_opts);
  var s2 = get_s2_collection(aoi, start_date, end_date, s2_filter, cs_thresh);
  var imgs = l30.merge(s2);
  return imgs;
};

exports.get_s2_collection = get_s2_collection;
exports.get_l30_collection = get_l30_collection;
exports.fmask = fmask;
exports.get_hls_collection = get_hls_collection;



//////////////////////////////////////////////////////////////////////////////
/// Testing
///

// // Get HLS collection and show time series at clicked point
// var imgs = get_hls_collection(geometry, '2017-01-01', '2024-01-01')
// // print(imgs)
// var band = 'swir1'
// Map.addLayer(imgs, {bands:[band], min:0.0, max:0.5}, 'mosaic')

// var time_series_chart = function(coords){
//   var point = ee.Geometry.Point([coords['lon'], coords['lat']])
//   var extract = imgs.filterBounds(point).map(function(i){return ee.Feature(point, 
//                                                     i.reduceRegion(ee.Reducer.first(), point, 30)
//                                                     .set('system:time_start', i.get('system:time_start'))
//                                                     .set('source', i.get('source')))})
//   var chart = ui.Chart.feature.groups(extract, 'system:time_start', band, 'source').setChartType('ScatterChart')
//   print(chart)
//   // print(extract)
// }
// Map.onClick(time_series_chart)

// // Details on a single image
// var img = ee.Image(imgs.toList(10).get(5))
// print(img)
// Map.addLayer(img, {bands:['red', 'green', 'blue'], min:0.0, max:0.26}, 'selected')
