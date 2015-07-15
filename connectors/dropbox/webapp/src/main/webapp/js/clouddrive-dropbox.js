/**
 * Dropbox support for eXo Cloud Drive.
 * 
 */
(function($, cloudDrive, utils) {

	/**
	 * Dropbox connector class.
	 */
	function TemplateClient() {
		// Provider Id for Template provider
		var PROVIDER_ID = "dropbox";

		var prefixUrl = utils.pageBaseUrl(location);

		/**
		 * Renew drive state object.
		 */
		var renewState = function(process, drive) {
			var newState = cloudDrive.getState(drive);
			newState.done(function(res) {
				drive.state = res;
				// this will cause sync also
				process.resolve();
			});
			newState.fail(function(response, status, err) {
				process.reject("Error getting drive state. " + err + " (" + status + ")");
			});
			return newState;
		};

		/**
		 * Check if given drive has remote changes. Return jQuery Promise object that will be resolved
		 * when some change will appear, or rejected on error. It is a method that Cloud Drive core
		 * client will look for when loading the connector module.
		 * 
		 * Cloud Drive client expects that connector's `onChange()` method returns jQuery Promise and
		 * then it uses the promise to initiate synchronization process. When the promise will be
		 * resolved (its `.resolve()` invoked), it will mean the drive has new remote changes and client
		 * will invoke the synchronization web-service and then refresh the UI. If promise rejected
		 * (`.reject(error)` invoked) then the synchronization will be canceled, and a new
		 * synchronization will be attempted when an user perform an operation on the Documents page
		 * (navigate to other file or folder, use Cloud Drive menu).
		 * 
		 * Thanks to use of jQuery Promise drive state synchronization runs asynchronously, only when an
		 * actual change will happen in the drive.
		 */
		this.onChange = function(drive) {
			var process = $.Deferred();

			if (drive) {
				// utils.log(">>> enabling changes monitor for Cloud Drive " + drive.path);

				if (drive.state) {
					// Drive supports state - thus we can send connector specific data via it from Java API
					// State it is a POJO in JavaAPI. Here it is a JSON object.

					// For an example here we assume that cloud provider has events long-polling service that
					// return OK when changes happen (this logic based on Box connector client - replace
					// response content and logic according your cloud service).
					var nowTime = new Date().getTime();
					var linkAge = nowTime - drive.state.created;
					if (linkAge >= drive.state.outdatedTimeout) {
						// long-polling outdated - renew it (will cause immediate sync after that)
						renewState(process, drive);
					} else {
						var linkLive;
						var changes = cloudDrive.ajaxGet(drive.state.url);
						changes.done(function(info, status) {
							clearTimeout(linkLive);
							if (info.message) {
								if (info.message == "new_change") {
									process.resolve();
								} else if (info.message == "reconnect") {
									renewState(process, drive);
								}
							}
						});
						changes.fail(function(response, status, err) {
							    clearTimeout(linkLive);
							    // if not aborted by linkLive timer or browser
							    if (err != "abort") {
								    if ((typeof err === "string" && err.indexOf("max_retries") >= 0)
								        || (response && response.error.indexOf("max_retries") >= 0)) {
									    // need reconnect
									    renewState(process, drive);
								    } else {
									    process.reject("Long-polling changes request failed. " + err + " (" + status + ") "
									        + JSON.stringify(response));
								    }
							    }
						    });
						// long-polling can outdate, if request runs longer of the period - need start a new one
						linkLive = setTimeout(function() {
							changes.request.abort();
							renewState(process, drive);
						}, drive.state.outdatedTimeout - linkAge);
					}
				} else {
					process.reject("Cannot check for changes. No state object for Cloud Drive on " + drive.path);
				}
			} else {
				process.reject("Null drive in onChange()");
			}

			return process.promise();
		};

		/**
		 * Read comments of a file. This method returns jQuery Promise of the asynchronous request.
		 */
		this.fileComments = function(workspace, path) {
			return cloudDrive.ajaxGet(prefixUrl + "/portal/rest/clouddrive/drive/dropbox", {
			  "workspace" : workspace,
			  "path" : path
			});
		};
	}

	var client = new TemplateClient();

	// On DOM-ready handler to initialize custom UI (or any other specific work on a client)
	if (window == top) { // run only in window (not in iframe as gadgets may do)
		try {
			$(function() {
				// Add an action to some button "Show File Comments"
				$("#file_comments_button").click(function() {
					var drive = cloudDrive.getContextDrive();
					var file = cloudDrive.getContextFile();
					if (drive && file) {
						var comments = client.readComments(drive.workspace, file.path);
						comments.done(function(commentsArray, status) {
							if (status != 204) { // NO CONTENT means no drive found or drive not connected
								// Append comments to a some invisible div on the page and then show it
								var container = $("#file_comments_div");
								$.each(commentsArray, function(i, c) {
									$("<div class='myCloudFileComment'>" + c + "</div>").appendTo(container);
								});
								container.show();
							} // else do nothing
						});
						comments.fail(function(response, status, err) {
							utils.log("Comments request failed. " + err + " (" + status + ") " + JSON.stringify(response));
						});
					}
				});
			});
		} catch(e) {
			utils.log("Error intializing Dropbox client.", e);
		}
	}

	return client;
})($, cloudDrive, cloudDriveUtils);
