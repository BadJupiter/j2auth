// Jupiter 2 mobile authentication and other API support
//
// CANONICAL SOURCE — github.com/BadJupiter/j2auth
//
// Every Jupiter app authenticates through this one file. Edit it HERE and
// distribute; never edit a deployed copy in place. Six copies had quietly
// forked before this was reconciled (2026-08-12), including a real behavioral
// split in the verify handler.
//
// API surface (globals — this is a classic script, not a module):
//   j2AuthInit(bizid, apptoken)   resolve the device cookie to a User
//   authenticateUser()            run the SMS modal; resolves true/false
//   j2SignOut()                   revoke the token server-side, drop cookie
//   isAuthenticated, userProfile  post-auth state
//   authError                     why the last auth step failed, for the UI
//   getCookie()                   the device token
//
// VERIFICATION IS SERVER-SIDE (changed 2026-09-11). It was not, and that was
// a full authentication bypass: /auth/ returned the code it had just texted
// along with a device token, this file compared the typed code to that value
// locally, and /register/ bound the token to the number without ever seeing a
// code. Knowing a phone number was enough to hold that person's session —
// including Jupiter staff, whose 'super' role gates the whole admin console.
//
// So: /auth/ returns no code and no token. /register/ takes {mobile, code},
// checks the code against a stored HMAC with an expiry and an attempt cap,
// and only then mints and returns the device token. Do not reintroduce a
// client-side comparison — there is nothing here an attacker cannot skip.
//
// OTP autofill is two mechanisms, not one. iOS fills the code from the
// autocomplete="one-time-code" attribute on the first code input (in each
// app's modal markup). Chrome on Android ignores that and needs the WebOTP
// API below, plus an SMS whose LAST line is "@<host> #<code>" — /auth/
// appends that from the request's Origin. Both are best-effort; typing the
// code always works.
//
// Requires: a `bootstrap.Modal`-compatible global (real Bootstrap, or the
// bs-shim.js used by the dashboards), VMasker, and the shared auth-modal
// markup — the element IDs below are addressed directly.
//
// PER-APP POLICY: after a successful verify this calls registerBusinessUser(),
// which creates a role-less (:User)-[:REGISTERED_FOR]->(:Business) edge. That
// is right for consumer apps — it's how a guest becomes known to a business —
// and wrong for admin dashboards, where merely attempting to sign in must not
// grant membership. Those opt out by overriding the global before any flow
// runs, rather than by forking this file:
//
//     window.registerBusinessUser = () => {};

console.log("j2auth initializing... (top level)");

const DEVICE_COOKIE = "jupiterDeviceID";

let bizID;

bizRegistrations = [];	// list of Business IDs this user is registered with

let appToken;			// application token for Jupiter graph

let userMobile;         // user's mobile number E164 unique ID

// Last failure from /auth/ or /register/, for UIs that want to say WHY —
// "Incorrect code" and "Too many attempts, request a new code" need different
// responses from the user, and a bare false cannot tell them apart.
let authError = null;

let userToken;			// authenticated user token (device cookie)
let userProfile;

// server URL might get overwritten with a local URL for testing
var serverURL = 'https://api.badjupiter.cloud';

const apiUserProfile = '/userprofile/';
const apiAuthMobile = '/auth/';
const apiAuthRegister = '/register/';
const apiRegisterBiz = '/register-biz/';
const apiSignOut = '/signout/';

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

// Ask the server to text a code.
//
// The response no longer CONTAINS the code — that was the bug. /auth/ used to
// return the code and a device token, so the SMS was decorative and anyone
// who knew a phone number could read both out of the JSON and post them to
// /register/. Now the only copy of the code goes to the phone, and the device
// token is not minted until /register/ proves the code.
//
// Returns truthy on success (the E164 mobile the server resolved), null on
// failure, with the reason in `authError`. Callers only test truthiness, so
// this stays drop-in for the old "returns the code" contract.
function requestAuthenticationCode(phoneNumber, bizid) {

	authError = null;

	return fetch(serverURL + apiAuthMobile, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ mobile: phoneNumber, bizid: bizid || bizID })
	})
	.then(async response => {
		const data = await response.json().catch(() => null);

		if (!response.ok) {
			// 429 carries the rate-limit message; show it rather than a
			// generic failure, or the user just keeps hammering the button.
			authError = data?.detail || `Could not send a code (${response.status})`;
			console.error("AUTH failed:", authError);
			return null;
		}

		if (!data?.mobile) {
			authError = "Could not send a code. Try again.";
			console.error("!! NO MOBILE IN AUTH RESPONSE !!");
			return null;
		}

		userMobile = data.mobile;
		return userMobile;
	})
	.catch(error => {
		console.error('Error:', error);
		authError = "Could not reach the server. Check your connection.";
		return null;
	});
}

// Send the typed code to the server and, if it checks out, take the device
// token the server hands back.
//
// This used to compare `userCode.trim() == serverCode` right here, in the
// browser, against a value the server had helpfully included in its own
// response. Anyone could skip this function entirely. The comparison now
// happens in /register/, against a stored HMAC, in constant time, once, with
// an attempt cap — none of which is enforceable from this side of the wire.
//
// Same signature and same boolean return as before, so every caller (the
// modal below, badgervision's verifyOTP) keeps working unchanged.
async function verifyAuthenticationCode(userCode) {

	authError = null;

	if (!userMobile) {
		authError = "Request a code first.";
		isAuthenticated = false;
		return false;
	}

	try {
		const response = await fetch(serverURL + apiAuthRegister, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				mobile: userMobile,
				code: String(userCode).trim()
			})
		});

		const data = await response.json().catch(() => null);

		if (!response.ok) {
			// 401 is a wrong/expired/burned code — an ordinary outcome, not
			// an exception. `detail` distinguishes them for the UI.
			authError = data?.detail || "Verification failed.";
			console.warn('AUTH VERIFY:', authError);
			isAuthenticated = false;
			return false;
		}

		if (!data?.token) {
			authError = "Verification failed.";
			isAuthenticated = false;
			return false;
		}

		isAuthenticated = true;
		setCookie(data.token, 30); // 30 days (server-side TTL is 90)
		userToken = getCookie();

		userProfile = await fetchUserProfile(appToken, userToken);

		console.log("AUTH!", userProfile);
		return isAuthenticated;

	} catch (error) {
		console.error('AUTH VERIFY:', error);
		authError = "Could not reach the server. Check your connection.";
		isAuthenticated = false;
		return false;
	}
}

// Sign out for real: revoke the token on the server, THEN drop the cookie.
//
// Sign-out used to be deleteCookie() alone, which only forgets the credential
// on this one device — the token stayed valid in the graph forever, so a copy
// taken from anywhere still worked. The cookie is cleared even if the revoke
// call fails; a user who pressed "log out" must end up logged out locally
// whatever the network did.
async function j2SignOut() {

	const tok = getCookie();

	if (tok) {
		try {
			await fetch(serverURL + apiSignOut, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ usertoken: tok })
			});
		} catch (error) {
			console.error('SIGNOUT (revoking anyway on next use):', error);
		}
	}

	deleteCookie();
	userToken = null;
	userProfile = null;
	userMobile = null;
	isAuthenticated = false;
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
		startOtpListener();
	};

	const collectCode = () => {
		return Array.from(codeInputs)
			.map((input) => input.value.trim())
			.join("");
	};

	// WebOTP — Chrome on Android only. Feature-detected, so it is a silent
	// no-op on iOS (which uses the autocomplete attribute) and on desktop.
	// The listener MUST be aborted when the modal closes: an outstanding
	// credentials.get() keeps a pending permission request alive and the next
	// sign-in attempt in the same page then rejects immediately.
	let otpAbort = null;

	const startOtpListener = () => {
		if (!("OTPCredential" in window)) return;
		otpAbort = new AbortController();
		navigator.credentials
			.get({ otp: { transport: ["sms"] }, signal: otpAbort.signal })
			.then((otp) => {
				if (!otp || !otp.code) return;
				const digits = String(otp.code).replace(/\D/g, "").slice(0, codeInputs.length);
				digits.split("").forEach((d, i) => { codeInputs[i].value = d; });
				verifyCodeBtn.disabled = !areAllInputsFilled();
				if (digits.length === codeInputs.length) verifyCodeBtn.focus();
			})
			.catch(() => { /* aborted, dismissed, or unsupported — never fatal */ });
	};

	const stopOtpListener = () => {
		if (otpAbort) { otpAbort.abort(); otpAbort = null; }
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

			// Returns the resolved E164 mobile, not a code — the code
			// only ever goes to the phone now.
			const sent = await requestAuthenticationCode(phoneNumber);

			if (sent) {
				showCodeStep();
			} else {
				// Carries the rate-limit message when the server sent one.
				throw new Error(authError || "Failed to send an authentication code");
			}
		} catch (error) {
			alert(error.message);
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

			// verifyAuthenticationCode() already sets the cookie, refreshes
			// userToken and fetches userProfile on success — see its body.
			// This handler used to repeat all three, costing a second
			// /userprofile/ round-trip on every sign-in. (Fix originated in
			// the IPS copy, 2026-01-04; folded in here so every app gets it.)
			const isAuthenticated = await verifyAuthenticationCode(userCode);

			if (isAuthenticated) {

				stopOtpListener();
				userToken = getCookie();   // re-read so callers see it immediately

				// Per-app policy — see the header. Deliberately not awaited.
				registerBusinessUser();

				authModal.hide();
				resolve(true); // Authentication successful
			} else {
				// authError says whether this was a wrong code, an expired
				// one, or the attempt cap — the user's next move differs.
				throw new Error(authError || "Verification failed");
			}
		} catch (error) {
			alert(error.message);
			verifyCodeBtn.disabled = false;
			codeInputs.forEach((input) => (input.value = ""));
			codeInputs[0].focus();
		}
	});

	// Show the modal and start the flow
	authModal.show();
	showPhoneStep();

	// If the modal is closed, reject the promise (optional)
	document
		.getElementById("authModal")
		.addEventListener("hidden.bs.modal", () => { stopOtpListener(); resolve(false); });
	});
}

