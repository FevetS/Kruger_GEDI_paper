/*
This is a module to hold general use snippets.
*/

var unique_dates = function(imgs, unit){
  // get the unique date units (e.g. year, month, or day) in an image collection
  return imgs.aggregate_array('system:time_start')
          .map(function(d){return ee.Date(d).get(unit)})
          .distinct() 
          .sort()
}
exports.unique_dates = unique_dates


var datetime_hist = function(imgs, unit){
  // get a histogram of date units (e.g. years) in an image collection
 return imgs.map(function(i){return i.set(unit, i.date().get(unit))})
         .aggregate_histogram(unit)
}
exports.datetime_hist = datetime_hist


var datetime_band = function(img, unit, inUnit, base){
    /* Return a band that contains datetime info based on system:time_start
    
    img: ee.Image
        Image to append datetime band to
        
    unit: str
        datetime unit for returned band passed to ee.Date.getRelative
        
    inUnit: str
        datetime unit that 'unit' is relative to. Passed to ee.Date.getRelative
    
    base: int
        base number to add to the value. getRelative() is 0-based, but a base of 1
        is likely more commonly desired (i.e. 1st day of year, not 0th day of year).
    */
    
    // set defaults
    unit = unit || 'day';
    inUnit = inUnit || 'year';
    base = base || 1;
    var band = ee.Image(img.date().getRelative(unit, inUnit).add(base)).rename('date').toInt16() // todo: consider rename as unit+'_of_'+inUnit
    return band
}
exports.datetime_band = datetime_band

var reclassify = function(img, cdict){
  // reclassify an image using a provided dictionary of {class: threshold}, where threshold is the upper bound of the class.
  // Classes must be greater than 0 and increasing with the thresholds(e.g.{1:-0.5, 2:0, 4:0.25, 62:1}). 
  // TODO: Fix to allow more flexibility in class number (e.g. 0, negative, or not in order)
  var reclass = function(i, q){
    var n = ee.Number.parse(i)
    var img_lt = img.lte(ee.Number(q)).multiply(n).byte().rename(['class'])
    return img_lt.updateMask(img_lt.eq(n))
  }
  
  var stack = ee.Dictionary(cdict).map(reclass)
  return ee.ImageCollection(stack.values()).min()
}
exports.reclassify = reclassify


var footprints = function(imgs){
  // Convert an image collection into a feature collection and keep all properties
  return ee.FeatureCollection(
            imgs.map(function f(i){
              return ee.Feature(i.geometry(), i.toDictionary())
                .copyProperties(i, ['system:time_start'])
                .set({'system_index':i.get('system:index')})
            }).copyProperties(imgs))
}
exports.footprints = footprints


var dailyMosaics = function(imgs){
  // Simplify image collection into daily mosaics.
  // Stolen from Ian Housman: https://groups.google.com/d/msg/google-earth-engine-developers/i63DS-Dg8Sg/_hgCBEYeBwAJ
  
  //Simplify date to exclude time of day
  imgs = imgs.map(function(img){
    var d = ee.Date(img.get('system:time_start'));
    var day = d.get('day');
    var m = d.get('month');
    var y = d.get('year');
    var simpleDate = ee.Date.fromYMD(y,m,day);
    return img.set('simpleTime',simpleDate.millis());
  });
  
  //Find the unique days
  var uniqueValues = function(collection,field){
    return ee.Dictionary(collection.reduceColumns(ee.Reducer.frequencyHistogram(),[field]).get('histogram')).keys();
  }
  var days = uniqueValues(imgs,'simpleTime');
  
  imgs = days.map(function(d){
    d = ee.Date(ee.Number.parse(d));
    var t = imgs.filterDate(d,d.advance(1,'day'));
    var f = ee.Image(t.first());
    t = t.mosaic();
    t = t.set('system:time_start',d.millis());
    t = t.copyProperties(f);
    return t;
    });
  return ee.ImageCollection.fromImages(imgs);
}
exports.dailyMosaics = dailyMosaics


var medoid = function(imgs, med_bands, date_band, unit, inUnit){
  /* Calculate the medoid for an image collection
  
  imgs: ee.ImageCollection
      A time series of images with the same bands
      
  med_bands: list
      List of band names to use for calculating the medoid
  
  date_band: bool
      Optionally return a band with the datetime of the image selected from
      medoid calculation based on system:time_start. Default is day of year.
      
  unit: str
      Datetime unit to get for for date_band passed to ee.Date.getRelative
  
  inUnit:str
      Relative unit passed to ee.Date.getRelative.
      
  returns: ee.Image
      Medoid mosaic containing all original bands, including those not used
      for medoid calculation, and an optional 'date' band.
  */
  
  // get median of selected bands
  var bands = imgs.first().bandNames();
  med_bands = med_bands || bands;
  var median = imgs.select(med_bands).median();
  
  // Add band with sum of squared differences from the median
  var diff_from_median = function(img, med_bands){
    // Sum of squared differences from the median
    var diff = ee.Image(img).select(med_bands).subtract(median).pow(ee.Image.constant(2));
    img = diff.reduce('sum').addBands(img).copyProperties(img, img.propertyNames());
    return img;
  };
  
  var med_dif = imgs.map(function(i){return diff_from_median(i, med_bands)});
  
  // Add optional date band
  if (date_band){
    // set defaults
    unit = unit || 'day';
    inUnit = inUnit || 'year';
    // add date band
    bands = bands.add('date');
    med_dif = med_dif.map(function(i){return i.addBands(datetime_band(i, unit, inUnit))});
  }
  
  // select the pixel with the min dif, then drop dif band and restore original band names
  var img = (ee.ImageCollection(med_dif)
              .reduce(ee.Reducer.min(bands.length().add(1)))
              .select(ee.List.sequence(1, bands.length()), bands)
         );
  
  return img;
};
exports.medoid = medoid;


// Flattten an ee.List of ee.Dictionary to a single ee.Dictionary
var flatten_dicts = function(dicts){
  var flat = dicts.map(function(d) {
    d = ee.Dictionary(d)
    return d.keys().zip(d.values())
  }).flatten()
  return ee.Dictionary(flat)
}
exports.flatten_dicts = flatten_dicts;
