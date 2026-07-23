(function(networkId) {
var automaticIntegrations = {"googleAnalytics":{"paramName":"g_cid"},"gaSessionId":{"paramName":"ga_session_id"}};

var cacheLifetimeDays = 30;

var customDataWaitForConfig = [
  { on: function() { return Invoca.Client.parseCustomDataField("calling_page", "Last", "JavascriptDataLayer", "location.hostname + location.pathname"); }, paramName: "calling_page", fallbackValue: null },
  { on: function() { return Invoca.Client.parseCustomDataField("customer_id", "Last", "URLParam", ""); }, paramName: "customer_id", fallbackValue: null },
  { on: function() { return Invoca.Client.parseCustomDataField("destination_time_zone", "Unique", "URLParam", ""); }, paramName: "destination_time_zone", fallbackValue: null },
  { on: function() { return Invoca.Client.parseCustomDataField("evaluated_by", "Unique", "URLParam", ""); }, paramName: "evaluated_by", fallbackValue: null },
  { on: function() { return Invoca.Client.parseCustomDataField("gbraid", "Last", "URLParam", ""); }, paramName: "gbraid", fallbackValue: null },
  { on: function() { return Invoca.Client.parseCustomDataField("gclid", "Last", "URLParam", ""); }, paramName: "gclid", fallbackValue: null },
  { on: function() { return Invoca.Client.parseCustomDataField("landing_page", "First", "JavascriptDataLayer", "location.href"); }, paramName: "landing_page", fallbackValue: null },
  { on: function() { return Invoca.Client.parseCustomDataField("msclkid", "Last", "URLParam", ""); }, paramName: "msclkid", fallbackValue: null },
  { on: function() { return Invoca.Client.parseCustomDataField("referrer", "First", "JavascriptDataLayer", "document.referrer"); }, paramName: "referrer", fallbackValue: null },
  { on: function() { return Invoca.Client.parseCustomDataField("reviewed_by", "Unique", "URLParam", ""); }, paramName: "reviewed_by", fallbackValue: null },
  { on: function() { return Invoca.Client.parseCustomDataField("utm_campaign", "Last", "URLParam", ""); }, paramName: "utm_campaign", fallbackValue: null },
  { on: function() { return Invoca.Client.parseCustomDataField("utm_content", "Last", "URLParam", ""); }, paramName: "utm_content", fallbackValue: null },
  { on: function() { return Invoca.Client.parseCustomDataField("utm_medium", "Last", "URLParam", ""); }, paramName: "utm_medium", fallbackValue: function() { return Invoca.PNAPI.currentPageSettings.poolParams.utm_medium || null; } },
  { on: function() { return Invoca.Client.parseCustomDataField("utm_source", "Last", "URLParam", ""); }, paramName: "utm_source", fallbackValue: function() { return Invoca.PNAPI.currentPageSettings.poolParams.utm_source || null; } },
  { on: function() { return Invoca.Client.parseCustomDataField("utm_term", "Last", "URLParam", ""); }, paramName: "utm_term", fallbackValue: null },
  { on: function() { return Invoca.Client.parseCustomDataField("wbraid", "Last", "URLParam", ""); }, paramName: "wbraid", fallbackValue: null }
];

var customDataWaitForConfigAnonymousFunctions = [
  { on: function() { return Invoca.Client.parseCustomDataField("calling_page", "Last", "JavascriptDataLayer", function() { return (location.hostname + location.pathname); }) }, paramName: "calling_page", fallbackValue: null },
  { on: function() { return Invoca.Client.parseCustomDataField("landing_page", "First", "JavascriptDataLayer", function() { return (location.href); }) }, paramName: "landing_page", fallbackValue: null },
  { on: function() { return Invoca.Client.parseCustomDataField("referrer", "First", "JavascriptDataLayer", function() { return (document.referrer); }) }, paramName: "referrer", fallbackValue: null }
];

var defaultCampaignId = "main_website";

var destinationSettings = {
  paramName: ""
};

var formTrackingEnabled = false;

var numbersToReplace = null;

var organicSources = false;

var reRunAfter = null;

var requiredParams = null;

var resetCacheOn = ['gclid', 'utm_source', 'utm_medium'];

var waitFor = 0;

var customCodeIsSet = (function() {
  Invoca.Client.customCode = function(options) {
    options.defaultCampaignId = Invoca.Tools.readUrl("utm_source") ? "paid_search_and_display" : "main_website";

function showNumber(){
$(".invocaNumber").animate({'opacity': 1}, 250) //utilize your CSS selector from numberSelector, or create a new class on your page
}
 
options.onComplete = showNumber;

setTimeout(function(){
showNumber();
}, 3000);


options.integrations = {
  googleAnalytics: true
};
return options;
  };

  return true;
})();

var generatedOptions = {
  active:              true,
  autoSwap:            true,
  cookieDays:          cacheLifetimeDays,
  country:             "US",
  dataSilo:            "us",
  defaultCampaignId:   defaultCampaignId,
  destinationSettings: destinationSettings,
  disableUrlParams:    [],
  doNotSwap:           ["+44 (0)20 3370 9681", "+44 (0)808 164 2887"],
  formTrackingEnabled: formTrackingEnabled,
  integrations:        automaticIntegrations,
  maxWaitFor:          waitFor,
  networkId:           networkId || null,
  numberToReplace:     numbersToReplace,
  organicSources:      organicSources,
  poolParams:          {},
  reRunAfter:          reRunAfter,
  requiredParams:      requiredParams,
  resetCacheOn:        resetCacheOn,
  waitForData:         customDataWaitForConfig,
  waitForDataAnonymousFunctions:  customDataWaitForConfigAnonymousFunctions
};

Invoca.Client.startFromWizard(generatedOptions);

})(64);
