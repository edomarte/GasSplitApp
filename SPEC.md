I want to create a webapp that owners of a shared car can use to record their kilometrage so that they can then split the fuel cost proportionally with their usage.
The app should run on website so it can be used both on pc, iphone and android phones.
The app should have the following functions:
Login with the standard most common ways (google auth, email & password)
A user must be able to create a "car" (a group with a car name)
A user should be able to invite another person to join the group it created (via QR code creation and sharing via email)
People in the same group must be able to:
See how many KM the people part of the group has made since the last refuelling, including the split drives)
Add a trip: in the trip adding visual (triggered by a button), a user must enter the start distance (which can also be autofilled with the latest kilometrage entered in the group), the final distance, the date (with a date selector), and if it is a split drive. If it is a split drive, the user must be able to select other group members to split the drive with. the drive is the split equally among the selected members. the user can then save the trip, which will be recorded.
The user must be able to add a fuel fill entering the cost of the refuel. Upon confirmation, the application must: calculate the cost for each group member based on its kilometrage since the last refuelling, reset the trip so it is empty (i.e., create a new trip), send an email notification to the group members with the split and what they have to send to whoever made the fill.