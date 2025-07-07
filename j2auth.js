// Jupiter 2 mobile authentication and other API support
// 
// THIS IS A SUBMODULE that will be shared by many apps for mobile authentication
// ...and this is an experiment to see if I can edit / update the repo from a project
//

console.log("j2auth initializing... (top level)");

const DEVICE_COOKIE = "jupiterDeviceID";

let bizID;

bizRegistrations = [];	// list of Business IDs this user is registered with

let appToken;			// application token for Jupiter graph

let userMobile;         // user's mobile number E164 unique ID
let serverCode;         // auth code returned by the server
let newDeviceToken;     // new token to store as cookie on device

let userToken;			// authenticated user token (device cookie)
let userProfile;

// server URL might get overwritten with a local URL for testing
var serverURL = 'https://api.badjupiter.cloud';

const apiUserProfile = '/userprofile/';
const apiAuthMobile = '/auth/';
const apiAuthRegister = '/register/';
const apiRegisterBiz = '/register-biz/';

function setCookie(cvalue, exdays) {
	console.log("set cookie");
	var d = new Date();
	d.setTime(d.getTime() + (exdays*24*60*60*1000));
	var expires = "expires="+ d.toUTCString();
	document.cookie = DEVICE_COOKIE + "=" + cvalue + ";" + expires + ";path=/";
}

function deleteCookie() {
  console.log("delete cookie");
  document.cookie = `${DEVICE_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

function getCookie() {
	
	const value = `; ${document.cookie}`;
//	console.log("COOKIE IS",value);
	const parts = value.split(`; ${DEVICE_COOKIE}=`);
	if (parts.length === 2) return parts.pop().split(';').shift();
}

// global variable to track authentication status

var isAuthenticated = false;

async function checkLocalConfig() {
	console.log("Check for local config info (server URL etc. - local.json");
	
	try {
		const response = await fetch('local.json');
		if (!response.ok) {
			console.error("Failed to fetch a local config file.");
			return false;
		}
		
		const config = await response.json();
		if (config['apiserver']) {
			serverURL = config['apiserver'];
			console.log("local config - API server:", serverURL);
		}
		return true;
	} catch (error) {
		console.error("Error loading local config file:", error);
		return false;
	}
}

async function fetchUserProfile(apptoken, usertoken) {
	
	if (usertoken) {
		console.log(`fetching profile: ${bizID}/${apptoken} (user token ${usertoken})`);
	} else {
		console.log(`fetching profile: ${bizID}/${apptoken} (no user token found)`);
	}
	
	biz_id = bizID; // for now... API is picky
	return fetch(serverURL+apiUserProfile, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ apptoken, biz_id, usertoken })
	})
	.then(response => response.json())
	.then(data => {
		return data;
	})
	.catch(error => {
		console.error("Error fetching user profile:", error);
		return null;
	});
}

// Jupiter 2 Authentication Initialization
// can be used by any app or website requiring Jupiter 2 mobile auth
//
// app token identifies the "app" (or site, page, whatever) and
// bizid is the Business entity in the graph
//

async function j2AuthInit(bizid,apptok) {

	console.log(`Jupiter 2 authentication init... (app token ${apptok})`)

	bizID = bizid;		// global
	appToken = apptok;	// global
	
	if (!bizid || !apptok) {

		console.error(`need a biz id and an app token to init`);
		return		
	}	

	userToken = getCookie();
//	console.log("GOT A COOKIE?",userToken)
	
	await checkLocalConfig();

	userProfile = await fetchUserProfile(appToken, userToken);
			
	console.log("user profile:",userProfile);
	
	if (userProfile.user) {                
		isAuthenticated = true;
	}
}

function requestAuthenticationCode(phoneNumber) {

	return fetch(serverURL + apiAuthMobile, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ mobile: phoneNumber, bizid: bizID })
	})
	.then(response => response.json())
	.then(data => {
		console.log("AUTH", data);
		if (data?.authcode) {
			userMobile = data.mobile;
			serverCode = data.authcode;
			newDeviceToken = data.newtoken;
			return serverCode;
		} else {
			console.error("!! DIDN'T GET AN AUTH CODE !!");
			return null;
		}
	})
	.catch(error => {
		console.error('Error:', error);
		return null;
	});
}

async function verifyAuthenticationCode(userCode) {

	if (userCode.trim() == serverCode) {
		console.log(JSON.stringify({ token: newDeviceToken, mobile: userMobile }));

		try {
			const response = await fetch(serverURL + apiAuthRegister, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					token: newDeviceToken,
					mobile: userMobile
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(`Error: ${response.status} - ${errorData.detail}`);
			}

			const responseData = await response.json();
			
			isAuthenticated = true;
			setCookie(newDeviceToken, 30); // 30 days (?)
			userToken = getCookie();

			userProfile = await fetchUserProfile(appToken, userToken);

			console.log("AUTH!", userProfile);
			return isAuthenticated;
			
		} catch (error) {
			console.error('AUTH VERIFY:', error);
			isAuthenticated = false;
			return isAuthenticated;
		}
	} else {
		
		isAuthenticated = false;
		return isAuthenticated;
	}
}

function getUserBusinessRegs(ph) {
	
	// hit the server to get a list of Business registrations for this phone number
	console.log(`TO DO: load Business registrations for ${ph}`);
}

function registerBusinessUser() {
	
	console.log(`registerBusinessUser in graph: ${userMobile}/${bizID}`)	
	
	if (userMobile && bizID) {
		
		console.log( JSON.stringify({ mob: userMobile, bizid: bizID }) );
		
		return fetch(serverURL + apiRegisterBiz, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ mob: userMobile, bizid: bizID, apptoken: appToken })
			})
			.then(response => response.json())
			.then(data => {
				return null;
			})
			.catch(error => {
				console.error('Error:', error);
				return null;
			});
	}
	else {
		
		console.log(`CANNOT registerBusinessUser ${userMobile}/${bizID}`);
	}
}


//	NEW FLOW! MUCH CLEANER!

async function authenticateUser() {
	 
	 return new Promise((resolve, reject) => {
		 const authModal = new bootstrap.Modal(document.getElementById("authModal"), {
		backdrop: "static", // Prevent closing the modal by clicking outside
	});

	// Elements
	const phoneInputStep = document.getElementById("authPhoneInput");
	const codeInputStep = document.getElementById("authCodeInput");
	const phoneInput = document.getElementById("phone");
	const sendCodeBtn = document.getElementById("sendCodeBtn");
	const verifyCodeBtn = document.getElementById("verifyCodeBtn");
	const codeInputs = document.querySelectorAll(".code-input");

	// Helper Functions
	const showPhoneStep = () => {
		phoneInputStep.classList.remove("d-none");
		codeInputStep.classList.add("d-none");
		phoneInput.value = "";
		sendCodeBtn.disabled = true;
	};

	const showCodeStep = () => {
		phoneInputStep.classList.add("d-none");
		codeInputStep.classList.remove("d-none");
		codeInputs.forEach((input) => (input.value = ""));
		codeInputs[0].focus();
	};

	const collectCode = () => {
		return Array.from(codeInputs)
			.map((input) => input.value.trim())
			.join("");
	};

	 VMasker(phoneInput).maskPattern('(999) 999-9999');
	 phoneInput.addEventListener('input', function() {
		 var phoneNumber = phoneInput.value;
		 var phoneNumberPattern = /^\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})$/;  // US phone format
		 if (phoneNumberPattern.test(phoneNumber)) {
			 sendCodeBtn.disabled = false;
		 } else {
			 sendCodeBtn.disabled = true;
		 }
	 });      
	
	sendCodeBtn.addEventListener("click", async () => {
		try {
			const phoneNumber = phoneInput.value.trim();
			sendCodeBtn.disabled = true;

			// Call your requestAuthenticationCode() function
			const serverCode = await requestAuthenticationCode(phoneNumber);

			if (serverCode) {
				showCodeStep();
			} else {
				throw new Error("Failed to get an authentication code");
			}
		} catch (error) {
			alert("Error sending code: " + error.message);
			sendCodeBtn.disabled = false;
		}
	});

	 verifyCodeBtn.disabled = true;
	 
	 function areAllInputsFilled() {
		 return Array.from(codeInputs).every(input => input.value.trim() != '');
	 }
	 codeInputs.forEach((input, index) => {
		 input.addEventListener('input', (e) => {
	 
			 const value = e.target.value;	
			 // Ensure only one character is allowed
			 if (value.length > 1) {
				 e.target.value = value.slice(0, 1);
			 }	
			 // Move to the next input if there's a value
			 if (value && index < codeInputs.length - 1) {
				 codeInputs[index + 1].focus();
			 }
			 verifyCodeBtn.disabled = !areAllInputsFilled();
		 });
	 
		 input.addEventListener('keydown', (e) => {
			 if (e.key === 'Backspace' && !e.target.value && index > 0) {
				 // Move to the previous input on Backspace if current is empty
				 codeInputs[index - 1].focus();
			 }
		 });
	 });

	verifyCodeBtn.addEventListener("click", async () => {
		try {
			const userCode = collectCode();
			if (userCode.length !== 4) {
				alert("Please enter a valid 4-digit code");
				return;
			}

			verifyCodeBtn.disabled = true;

			// Call your verifyAuthenticationCode() function
			const isAuthenticated = await verifyAuthenticationCode(userCode);

			if (isAuthenticated) {

				  setCookie(newDeviceToken, 30); // 30 days (?)
				userToken = getCookie();
		  
				  userProfile = await fetchUserProfile(appToken, userToken);
				  
				registerBusinessUser(); // don't need to wait on this 

				authModal.hide();
				resolve(true); // Authentication successful
			} else {
				throw new Error("Verification failed");
			}
		} catch (error) {
			alert("Error verifying code: " + error.message);
			verifyCodeBtn.disabled = false;
		}
	});

	// Show the modal and start the flow
	authModal.show();
	showPhoneStep();

	// If the modal is closed, reject the promise (optional)
	document
		.getElementById("authModal")
		.addEventListener("hidden.bs.modal", () => resolve(false));
	});
}

