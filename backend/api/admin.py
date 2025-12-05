from django.contrib import admin
from .models import Incident, Task, Unit, User

admin.site.register(User)
admin.site.register(Incident)
admin.site.register(Task)
admin.site.register(Unit)
